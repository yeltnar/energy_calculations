import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs/promises';
import config from 'config';
import Decimal from 'decimal.js';

import download_energy_report from './download_energy_report.js';
import {getProductionContent} from './getProductionContent.js'
import {loadEnergyPrices, downloadPricingHistoryArr} from './loadEnergyPrices.js'
import {getBillData} from './readBillSvg.js';
import { readdir } from 'fs';

const ONE_SEC = 1000;
const ONE_MIN = ONE_SEC * 60;
const ONE_HR = ONE_MIN * 60;
const ONE_DAY = ONE_HR * 24;

const PCU_RATE = 0.001667;
const GROSS_RECEIPT_TAX_REIMBURSEMENT = 0.01997;

// TODO make dynamic
const ENERGY_PRICE = new Decimal('0.1364637826');

function timeoutPromise(ms){
  return new Promise((resolve, reject)=>{
    setTimeout(resolve,ms);
  }); 
}

// returns a date in nubmer form 
function addOneDay( date_str ){
  const date = new Date(date_str);
  return date.setDate(date.getDate()+1);
}

export function fixBillPeriods({cur, add_one_day=true, include_end_day=false}){

  cur._in_start = cur.start;
  cur._in_end = cur.end;

  if( add_one_day===true ){
    // typically for reading bill pdf/svg 
    cur.start = addOneDay(cur.start);
    cur.end = addOneDay(cur.end)-1; // subtract 1 to get last ms of ending day 
  }else if( include_end_day===true ){
    // typically when GUI is requesting range 

    cur.start = new Date(cur.start).getTime();
    const end_date = new Date(cur.end);
    const date_check = end_date.getHours() + end_date.getMinutes() + end_date.getSeconds();
    
    // else/if to go to end of current day or not
    if( date_check === 0 ){
      cur.end = addOneDay(cur.end)-1; // subtract 1 to get last ms of ending day 
    }else{
      cur.end = end_date.getTime()+1; // add 1 to make sure to include current time segment 
    }
    
  }else{
    cur.start = new Date(cur.start).getTime();
    cur.end = new Date(cur.end).getTime()-1; // subtract 1 to get last ms of ending day 
  }
  return cur;
}

const out_directory = "./out";

async function readMeterContentFromDisk( file_path = process.argv[2] ){
  // console.log(`file_path is ${file_path}`);
  return (await fs.readFile(file_path)).toString(); 
}

async function loadSingleDayMeterData( file_path ){

  const input = await readMeterContentFromDisk( file_path );

  let records = parse(input, {
    columns: true,
    skip_empty_lines: true
  });

  // very coupled 
  firstFormat(records);

  const records_obj = listToObjSupplementData(records);

  return records_obj;
}

// TODO cache response 
async function getBillPeriods({fix_bill}={fix_bill:true}){

    // fix_bill = fix_bill===undefined ? true : false;
  
    // start dates should be the day after cuz they don't look at the that day
    // end dates should be the day after finish so math works out 
    // bill_periods
  
    const svg_bill_periods = await getBillData();
  
    let proto_bill_periods = [
      // add 'all' bill period 
      {
        "start": "0",
        "end": new Date().getTime(),
        is_abstract: true,
      },
      ...config.bill_periods,
      ...svg_bill_periods,
    ];
  
    // fix bill periods to real periods 
    let periods = proto_bill_periods.map(cur=>fixBillPeriods({cur}));
    
    // remove dups 
    periods = periods.reduce(( acc, cur, i, arr )=>{
      
      let should_add = true;
      
      acc.forEach((added_ele)=>{
        if( cur.start===added_ele.start && cur.end===added_ele.end ){
          should_add=false;
        }
      });
      
      if (should_add === true) {
        acc.push(cur);
      }
      
      return acc;
    },[]);

    // add latest bill period
    (()=>{
      const latest_bill_obj = (()=>{
        let latest_date = -1;
        let cur_latest = -1;
        svg_bill_periods.forEach((cur, i, arr)=>{
          if(cur.from_bill===true && cur.end > latest_date){
            latest_date = cur.end;
            cur_latest = cur;
          }
        })
        return cur_latest;
      })();
      const end_obj = new Date();
      const start = latest_bill_obj.end ? latest_bill_obj.end : 0;
      const end = end_obj.getTime();
      const to_push = {
        ...latest_bill_obj,
        start,
        end,
        _in_start: new Date(start).toString(),
        _in_end: new Date(end).toString(),
      }
      delete to_push.energy_usage;
      delete to_push.from_bill;
      periods.push(to_push);
    })();
  
    return periods;
  }
  
// TODO move out of this function block 
async function writeRecordsCSVandJSON({records_obj, start, end, dir, name, write}){
  const csv_path = `${dir}/${name}.csv`;
  const json_path = `${dir}/${name}.json`;

  const cur_records_obj = await getRecordsRange({records_obj, start, end});
      
  let final_arr = getCSVArr(cur_records_obj);
  const csv_content = stringify(final_arr);

  if(write===true){
    return await Promise.all([
        await fs.writeFile( csv_path , csv_content ),
        await fs.writeFile( json_path , JSON.stringify(cur_records_obj,null,2) ),
    ]);
  }
}

export const setupRecordsObj = (() => {

    let records_obj;
    let pending_promise = (async()=>{})();

    let last_file_read = -1;

    async function wrapper() {
      await pending_promise;

      const files_changed = await filesChanged();

      // memoize 
      if (records_obj === undefined || files_changed === true) {
        pending_promise = setupRecordsObj({write:false});
        pending_promise.then(()=>{
          last_file_read = new Date().getTime();
        });
      }

      return await pending_promise;
    }

    async function setupRecordsObj({write}) {
      
        // TODO {fix_bill: true}?
        const bill_periods = await getBillPeriods();

        const in_directory = './in_csv';

        const energy_prices_v1 = await loadEnergyPrices();

        if (config.check_email === true) {
            const num_results = 3;
            await download_energy_report(in_directory, num_results);
        }

        records_obj = await loadMeterData(in_directory);

        const date_list = Object.keys(records_obj).reduce((acc, key) => {
            const cur = records_obj[key];
            const time = cur.usage_date;
            if (acc.indexOf(time) < 0) {
                acc.push(time);
            }
            return acc;
        }, []);

        const energy_prices_v2 = await downloadPricingHistoryArr(date_list);
        const energy_prices = { ...energy_prices_v1, ...energy_prices_v2 };

        const production_obj = await getProductionContent(date_list);

        addRawProduction(records_obj, production_obj)
        addTotalUsage(records_obj);
        invertField(records_obj, 'consumption');
        addGrossUsage(records_obj);
        addBillPeriod(records_obj, bill_periods);
        addPrice(records_obj, energy_prices);
        addTotalChargeNoTax(records_obj);

        if (config.print_largest_production === true) {
            const largest_production = getLargestProduction(records_obj);
            console.log({ largest_production });
        }

        // write with all data 
        await writeRecordsCSVandJSON({
            dir: "./out",
            name: 'all',
            records_obj,
            start: 0,
            end: (new Date('Jan 01 3024').getTime()),
            write,
        });

        return records_obj;
    }

    async function filesChanged(){

      const dir = './in_csv';
      const files = await fs.readdir(dir);

      let to_return = false;

      await Promise.all(files.map(async(cur)=>{
        const stat = await fs.stat(`${dir}/${cur}`);
        // console.log({
        //   cur,
        //   c: last_file_read < stat.mtimeMs,
        //   now: last_file_read,
        //   file_time: stat.mtimeMs,
        // });
        to_return = to_return || last_file_read < stat.mtimeMs;
      }));

      // TODO remove 
      console.log({
        filesChanged: to_return,
        d: (new Date().getTime()) - last_file_read,
      });

      return to_return;
    }

    // TODO if want this, can't have it run twice with one shot 
    wrapper();

    return wrapper;
})();

// main
export async function main({write, return_individual_data}){

  const bill_periods = await getBillPeriods({fix_bill:true});

  console.log('start');
  
  const records_obj = await setupRecordsObj({write});

  // bill_periods
  const to_wait = bill_periods.map(async(cur)=>{
    // console.log({cur})
    return await getInfoForRange({records_obj, cur, write, return_individual_data});
  });

  const report = await Promise.all(to_wait); 

  if( config.print_bill_period_results === true ){
    report.forEach(c=>console.log(c));
    // console.log(report);
  }

  console.log('done');  

  return report;
}

export async function getInfoForRange( {records_obj, cur, write, return_individual_data, most_recent_count} ){

    if( return_individual_data === undefined ){
      return_individual_data = false;
    }

    const name = getSimpleMonth(cur.end);

    const cur_records_obj = await getRecordsRange({most_recent_count, records_obj, start:cur.start, end:cur.end});

    if(Object.keys(cur_records_obj).length <= 0){
      throw new Error('no records for time range');
    }

    const energy_charge  = cur.energy_charge;
    const ercot_rate = cur.ercot_rate;
    const oncor_rate = cur.oncor_rate;
    let base_fee = cur.base_fee;

    if(base_fee===undefined){
      base_fee = 0;
    }

    const total_credit_earned = await (async()=>{      
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        
        if(cur_records_obj[k].earned===undefined ){continue;}

        to_return = (to_return.add(cur_records_obj[k].earned));
        if(  Number.isNaN(to_return) ){
          throw new Error(`found NaN\n${JSON.stringify({
            earned: cur_records_obj[k].earned,
            k,
            date: new Date(parseFloat(k)).toString(),
          },null,2)}`)
        }
      }
      return to_return.toNumber();
    })();

    const oppo_earned = await (async()=>{
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){


        if(cur_records_obj[k].saved===undefined){continue;}

        to_return = to_return.add(cur_records_obj[k].saved);
        if(  Number.isNaN(to_return) ){
          throw new Error(`found NaN\n${JSON.stringify({
            saved: cur_records_obj[k].saved,
            k,
            date: new Date(parseFloat(k)).toString(),
          },null,2)}`)
        }
      }
      return to_return.times(-1).toNumber();
      
    })();

    const total_earned_toward_solar = new Decimal(oppo_earned).add(total_credit_earned).toNumber();

    const total_consumption = await (async()=>{      
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].consumption===undefined){
          throw new Error(`cur_records_obj[k].consumption is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k].consumption));
      }
      return to_return.toNumber();
    })();

    // sum of total usage 
    const total_usage = await (async()=>{      
      let total_usage = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].total_usage===undefined){
          throw new Error(`cur_records_obj[k].total_usage is undefined`);
        }
        total_usage = (new Decimal(total_usage).add(cur_records_obj[k].total_usage));
      }
      total_usage = total_usage.toNumber();

      return total_usage;
    })();

    const total_surplus_generation = await (async()=>{      
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        to_return = (new Decimal(to_return).add(cur_records_obj[k]['surplus_generation'] || 0));
      }
      return to_return.toNumber();
    })();

    const total_raw_production = await (async()=>{      
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].raw_production===undefined){
          throw new Error(`cur_records_obj[k].raw_production is undefined`);
        }
        to_return = to_return.add(cur_records_obj[k].raw_production);
      }
      return to_return.toNumber();
    })();

    const total_spend = await (async()=>{      
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].spend===undefined){continue;}
        to_return = (new Decimal(to_return).add(cur_records_obj[k].spend));
      }
      // to_return.add(9.95).add(3.59); // TODO factor in base charges 
      return to_return.toNumber();
    })();

    const total_oncor_price = await (async()=>{      
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].oncor_price===undefined){continue;}
        to_return = (new Decimal(to_return).add(cur_records_obj[k].oncor_price));
      }
      return to_return.toNumber();
    })();

    const total_energy_charge = await (async()=>{   
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].energy_charge===undefined){continue;}
        to_return = (new Decimal(to_return).add(cur_records_obj[k].energy_charge));
      }
      return to_return.toNumber();
    })();
    
    let total_charge_no_tax = await (()=>{ 
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){

        if(cur_records_obj[k].charge_no_tax===undefined){
          throw new Error(`cur_records_obj[k].charge_no_tax is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k].charge_no_tax));
      }
      return to_return.toNumber();
    })();
    total_charge_no_tax = new Decimal(total_charge_no_tax)
                          .minus(base_fee); // minus cuz of how positive/negitive works out 

    const {total_ercot_price, total_ercot_price_rounded} = await (async()=>{      
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].ercot_price===undefined){continue;}
        to_return = (new Decimal(to_return).add(cur_records_obj[k].ercot_price));
      }
      return {
        total_ercot_price: to_return.toNumber(),
        total_ercot_price_rounded: to_return.times(100).floor().div(100).toNumber(),
      }
    })();

    const {earliest_obj, latest_obj} = await(async()=>{
      let earliest_obj = {ms:Number.MAX_VALUE};
      let latest_obj = {ms:0};
      for(let k in cur_records_obj){
        if( cur_records_obj[k].ms > latest_obj.ms ){
          latest_obj = cur_records_obj[k];
        }
        if( cur_records_obj[k].ms < earliest_obj.ms ){
          earliest_obj = cur_records_obj[k];
        }
      }
      return {earliest_obj,latest_obj};
    })();

    // sum of total_usage + sum of raw_production // tells you if you're consuming or producing more 
    const gross_usage = await (async()=>{   
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].gross_usage===undefined){throw new Error('gross_usage not defined');continue;}
        to_return = (new Decimal(to_return).add(cur_records_obj[k].gross_usage));
      }
      return to_return.toNumber();
    })();
    const old_gross_usage = new Decimal(total_usage).add(total_raw_production).toNumber();

    ////// monthly calculations //////
    const days_in_range = new Decimal(latest_obj.ms).minus(earliest_obj.ms).dividedBy(86400000).ceil().toNumber();
    const avg_earned = new Decimal(total_credit_earned).dividedBy(total_surplus_generation).toNumber();
    const gross_receipt_tax_reimbursement_price = new Decimal(GROSS_RECEIPT_TAX_REIMBURSEMENT).times(total_charge_no_tax).toNumber();
    const pcu_rate_price = new Decimal(PCU_RATE).times(total_charge_no_tax).toNumber();    
   
    const total_fee = 
      new Decimal(gross_receipt_tax_reimbursement_price)
      .add(pcu_rate_price)
      .add(total_charge_no_tax)
      .toNumber();    

    const total_charge = 
      new Decimal(total_fee)
      .add(total_credit_earned) // add earned after calculating price of taxes // positive is in your favor 
      .toNumber();    
    ////// end of monthly calculations //////

    const gross_spend = new Decimal(total_credit_earned).add(total_spend).toNumber();    

    // create csv and json
    await writeRecordsCSVandJSON({
      dir:"./out",
      name,
      records_obj, 
      start: cur.start, 
      end: cur.end,
      write,
    }); 
    
    const largest_production = getLargestProduction(cur_records_obj);

    

    const to_return = {
      times:{
        period_start: new Date(cur.start).toString(),
        period_end: new Date(cur.end).toString(),
        earliest_record: earliest_obj.usage_time,
        latest_record: latest_obj.usage_time,
        days_in_range,
        start_distance_from_today: new Decimal((new Date().getTime() - new Date(earliest_obj.usage_time)) / ONE_DAY).times(1000).round().dividedBy(1000).toNumber(),
      },
      info: {
        production_info: {
          'consuming or producing more: gross_usage': gross_usage,
          'used from both sources: total_usage': total_usage,
          "raw production: total_raw_production": total_raw_production,
          "largest production time: largest_production_raw_production": largest_production.raw_production,
          "largest production time: largest_production_usage_time": largest_production.usage_time,
          avg_produced: new Decimal(total_raw_production).dividedBy(days_in_range).toNumber(),
        },
        bill: {
          "taken from grid: total_consumption": total_consumption,
          "sent to grid: total_surplus_generation": total_surplus_generation,
          "bill credit earned: total_credit_earned": total_credit_earned,
          "tax1: gross_receipt_tax_reimbursement": gross_receipt_tax_reimbursement_price,
          "tax2: pcu_rate": pcu_rate_price,
          "energy provider charge: total_energy_charge": total_energy_charge,
          "oncor charge: total_oncor_price": total_oncor_price,
          "ercot charge: total_ercot_price_rounded": total_ercot_price_rounded,
          "total fee without solar: total_fee": total_fee,
          "to be charged to card: total_charge": total_charge,
          'avg earned for solar production: avg_earned':avg_earned,
        },
        money: {
          "bill credit earned: total_credit_earned": total_credit_earned,
          "earned by not buying from grid: oppo_earned": oppo_earned,
          "earned toward solar: total_earned_toward_solar": total_earned_toward_solar,
        }
      },
      // need_to_fix:{
      //   // "_______________":"______________________________",
      //   'off a cents; watch consumption number; round up charge': total_ercot_price,
      //   'total_ercot_price_rounded': total_ercot_price_rounded,
      // },
      // new_ones:{
      // }
    }

    if( return_individual_data ){
      to_return.individual_data = minimizeData(cur_records_obj);
    }

    return to_return;
}

function minimizeData( records_obj ){
  // we want to delete _og_data and make it an array 
  const to_return = [];
  for( let k in records_obj ){
    const to_push = JSON.parse(JSON.stringify(records_obj[k]));
    delete to_push._og_data;
    to_return.push(to_push);
  }
  return to_return;
}

async function loadMeterData( in_directory ){

  let records_obj = {};

  let csv_list = await fs.readdir(in_directory);
  csv_list = csv_list.filter(c=>/.csv$/i.test(c));

  for( let i=0; i<csv_list.length; i++ ){
    const file_path = `${in_directory}/${csv_list[i]}`;
    const local_records_obj = await loadSingleDayMeterData( file_path ).catch(e=>{
      console.error(e);
      throw new Error(`error parsing file: ${csv_list[i]}`);
    });

    for ( let k in local_records_obj ){
      records_obj[k] = {...records_obj[k], ...local_records_obj[k]}
      
    }
  }

  return records_obj;
}

function getSimpleMonth(date_var){

    const d = new Date(date_var);

    const year = d.getFullYear();
    let month = d.getMonth()+1;
    let day = d.getDate();

    if( month<10 ){
      month = "0"+month;
    }

    if( day<10 ){
      day = "0"+day;
    }

    return `${year}-${month}-${day}`;
}

// TODO very coupled 
function firstFormat(records){
  records.forEach(c=>{
    c.USAGE_TIME = `${c.USAGE_DATE} ${c.USAGE_START_TIME}`;
    c.USAGE_TIME = c.USAGE_TIME.split("  ").join(" ");
    c.USAGE_MS = new Date(c.USAGE_TIME).getTime();
  });
}

function listToObjSupplementData(records){

  const records_obj = {};

  records.forEach((c)=>{
    
    const key = c.USAGE_MS;
    const type = fixType(c.CONSUMPTION_SURPLUSGENERATION);

    // initalize if undefined 
    if ( records_obj[key] === undefined ){

      const USAGE_MS = c.USAGE_MS;

      records_obj[key] = {
        "ms": USAGE_MS,
        "usage_time": new Date(USAGE_MS).toString(),
      }
    }

    if( records_obj[key]._og_data === undefined ){
      records_obj[key]._og_data = {};
    }
    records_obj[key]._og_data[type] = c
    records_obj[key][type] = parseFloat(c.USAGE_KWH);
    
    const arr = c.USAGE_DATE.split('/');    
    arr[2] = arr[2].length<4?"20"+arr[2]:arr[2];
    records_obj[key].usage_date = `${arr[2]}-${arr[0]}-${arr[1]}`;
  });

  return records_obj;
}

function fixType( type ){
  if( type === "Surplus Generation" ){
    return 'surplus_generation';
  }if( type === "Consumption" ){
    return 'consumption';
  }else{
    throw new Error('unknown type for fixType');
  }
}

function addRawProduction( records_obj, production_obj ){

  for( let k in records_obj ){
    // divide by 1000 to convert to KWh 

    if( production_obj[k]!==undefined ){
      const production = production_obj[k].value;
      records_obj[k].raw_production = new Decimal(production).dividedBy(1000).toNumber(); 
    }else{
      records_obj[k].raw_production = 0; 
    }
  }

  return records_obj;
}

function addTotalUsage(records_obj){

  for( let k in records_obj ){
    const c = records_obj[k];
    c.total_usage = new Decimal(c.raw_production)
      .times(-1)
      .add( c['surplus_generation'] || 0 )
      .sub( c['consumption'] || 0 )
      .toNumber();
  }

}

function invertField(records_obj, field){
  for( let k in records_obj ){
    records_obj[k][field] = records_obj[k][field] * -1;
  }
}

function addPrice(records_obj, energy_prices){

  for( let k in records_obj ){

    if(records_obj[k].ercot_price===undefined){
      // console.log(records_obj[k]);
      // throw new Error('records_obj[k].ercot_price');
      records_obj[k].missing_ercot_price = true;
      records_obj[k].skipped_price = "ercot_price is missing";
      continue;
    }
    if(records_obj[k].energy_charge===undefined){
      throw new Error('records_obj[k].energy_charge');
      records_obj[k].skipped_price = "energy_charge is missing";
      continue;
    }
    if(records_obj[k].oncor_price===undefined){
      // console.log(records_obj[k]);
      // throw new Error('records_obj[k].oncor_price');
      records_obj[k].skipped_price = "oncor_price is missing";
      continue;
    }

    // records_obj[k].
    const bill_energy_price = new Decimal(records_obj[k].energy_charge).add(records_obj[k].ercot_price).add(records_obj[k].oncor_price);

    const ms = records_obj[k].ms;
    const price_obj = energy_prices[ms];

    if( price_obj!==undefined ){

      records_obj[k].price = price_obj.settlement_point_price_dollar_kwh.toNumber();
      records_obj[k].price_uncapped = price_obj.settlement_point_price_dollar_kwh_uncapped.toNumber();
      records_obj[k].earned = price_obj.settlement_point_price_dollar_kwh.times(records_obj[k]['surplus_generation'] || 0).toNumber();
      if(null===records_obj[k].earned){
        throw new Error('bad records_obj[k].earned');
      }
    }else{
      console.error({
        msg:'price undefined',
        o: records_obj[k].usage_time,
        ms,
        k,
      })
      throw new Error('bad energy price'); // TODO remove 
      records_obj[k].price = NaN;
      records_obj[k].earned = NaN;
      records_obj[k].spend = NaN;
      
    }

    records_obj[k].spend = bill_energy_price.times(records_obj[k]['consumption']).times(-1);
    // records_obj[k].spend = bill_energy_price.times(records_obj[k]['consumption']);

    // for saved // TODO move to its own function? 
    // note: raw production is 0 regardless of if panels were recording or not, per the API 
    if( records_obj[k].surplus_generation !== undefined ){ // We want to only account for days when we have surplus generation data
      let meter_side_use = new Decimal(records_obj[k].raw_production).minus(records_obj[k].surplus_generation).toNumber();
      meter_side_use = meter_side_use < 0 ? 0 : meter_side_use; // if the meter and solar generation disagree, force to zero (likely close any way)
      records_obj[k].meter_side_use = meter_side_use;
      records_obj[k].saved = bill_energy_price.times(meter_side_use).toNumber();
    }else{
      records_obj[k].saved = 0;
    }

    records_obj[k].bill_energy_price = bill_energy_price.toNumber();
  }
  return records_obj;
}

function addTotalChargeNoTax( records_obj ){
  for( let k in records_obj){
    const record = records_obj[k];

    if( record.energy_charge===undefined || record.oncor_price===undefined || record.ercot_price===undefined ){
      record.charge_no_tax = 0;  
    }else{
      record.charge_no_tax = new Decimal(record.energy_charge)
      .add(record.oncor_price)
      .add(record.ercot_price)
    }
      
  }
}

function addGrossUsage(records_obj){
  for( let k in records_obj){
    const record = records_obj[k];
    // consumption is negitive     
    record.gross_usage = new Decimal(record.raw_production).add(record.total_usage).toNumber(); 
  }
}

function addBillPeriod(records_obj, bill_periods){

  for( let k in records_obj){
    const record = records_obj[k];

    // this logic will only take the latest bill period on the records object 
    bill_periods.forEach(( bill_period )=>{

      if(bill_period.is_abstract===true){return;}

      // if( record.ms >= bill_period.start && record.ms < bill_period.end ){
      if( bill_period.start <= record.ms && record.ms <= bill_period.end ){
        // console.log(`${record.usage_time} --- ${bill_period.start} - ${record.ms} - ${bill_period.end}`);
        bill_period.d = bill_period.d || [];
        bill_period.d.push(record);

        if( bill_period.end !== undefined){
          record.bill_period = bill_period.end; // maybe use start... use start everywhere else but not for bill periods 
        }
        if( record.energy_charge===undefined && bill_period.energy_charge !== undefined){
          record.energy_charge = new Decimal(record.consumption).times(bill_period.energy_charge);
        }

        // we calculate price from rate
        if( record.ercot_price===undefined && bill_period.ercot_rate !== undefined){
          record.ercot_price = new Decimal(record.consumption).times(bill_period.ercot_rate);
        }
        // we calculate price from rate
        if( record.oncor_price===undefined && bill_period.oncor_rate !== undefined){
          record.oncor_price = new Decimal(record.consumption).times(bill_period.oncor_rate);
        }
      }
    });    
  }
  return records_obj;
}

async function getRecordsRange({most_recent_count, records_obj, start, end }){

  if (most_recent_count !== undefined) {

    let records_keys = Object.keys(records_obj);

    // sort the keys so we can get the newset 
    records_keys = records_keys.sort((a, b) => {
      if (a < b) {
        return 1;
      } else if (a > b) {
        return -1;
      }
      return 0;
    });

    let end_date = new Date(records_obj[records_keys[0]].ms);
    end_date.setMinutes(59);
    end_date.setHours(23);
    end = end_date.getTime();

    let start_date = new Date(end);
    start_date.setDate(start_date.getDate() - most_recent_count + 1); // add 1 cuz get last day for free
    start_date.setMinutes(0);
    start_date.setHours(0);
    start = start_date.getTime();
  }

  let to_return = {};

  for( let k in records_obj ){
    const {ms} = records_obj[k];
    if( start <= ms && ms < end ){
      to_return[k] = records_obj[k];
    }
  }

  return to_return;
}

function getCSVArr(records_obj){

  // TODO only need one array now
  let column_headers = ['ms', 'usage_time', 'surplus_generation', 'consumption', 'raw_production', 'total_usage', 'earned', 'price_uncapped', 'price'];
  let key_values     = ['ms', 'usage_time', 'surplus_generation', 'consumption', 'raw_production', 'total_usage', 'earned', 'price_uncapped', 'price'];
  let final_arr = [];
  for ( let k in records_obj){
    const new_record = []; // line starts with the ms line 
    
    key_values.forEach((c)=>{
      let to_push = records_obj[k][c];
      
      if(c==='surplus_generation' && to_push===undefined){
        to_push = 0;
      }

      new_record.push(to_push);
    });
    
    final_arr.push(new_record);
  }

  // sort based on time stamp 
  final_arr = final_arr.sort((a,b)=>{

    if( typeof a[0] === 'string'){
      return -1;
    }
    if( typeof b[0] === 'string'){
      return 1;
    }

    return a[0] - b[0];
  });

  final_arr.unshift(column_headers);

  return final_arr;
}

function getBaseFee( cur_records_obj ){
  const first_obj = cur_records_obj[Object.keys(cur_records_obj)[0]];

  for( let k in bill_periods ){
    if(bill_periods[k].base_fee===undefined){continue};

    if(bill_periods[k].d.includes(first_obj)){
      return bill_periods[k].base_fee;
    }
  }

  console.log('----- did not find base fee');
  process.exit(-1);
}

function getLargestProduction( records_obj ){

  // console.log(Object.keys(records_obj));
  let max_obj = null;

  for( let k in records_obj ){    
    if(max_obj===null){
      max_obj = records_obj[k];
    }else if( max_obj.raw_production < records_obj[k].raw_production ){
      max_obj = records_obj[k];
    }
  }

  // records_obj.forEach((cur)=>);
  return max_obj;
}


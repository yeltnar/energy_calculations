import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs/promises';
import config from 'config';
import Decimal from 'decimal.js';

import download_energy_report from './download_energy_report.js';
import {getProductionContent} from './getProductionContent.js'
import {loadEnergyPrices, downloadPricingHistoryArr} from './loadEnergyPrices.js'
import {getBillData} from './readBillSvg.js';

const PCU_RATE = 0.001667;
const GROSS_RECEIPT_TAX_REIMBURSEMENT = 0.01997;

// TODO make dynamic
const ENERGY_PRICE = new Decimal('0.1364637826');

function timeoutPromise(ms){
  return new Promise((resolve, reject)=>{
    setTimeout(resolve,ms);
  }); 
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

// main
(async()=>{

  const bill_periods = await(async()=>{

    function addOneDay( date_str ){
      const date_obj = new Date(date_str);
      const day = date_obj.getDate()+1; // add one cuz bill is odd 
      const month = date_obj.getMonth()+1; // JS months are weird 
      const year = date_obj.getFullYear();
      const str = `${month}/${day}/${year}`;
      const new_date = new Date(str);
      const new_ms = new_date.getTime();
      return new_ms;
    }
  
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
    let periods = proto_bill_periods.map((cur)=>{
      cur._in_start = cur.start;
      cur._in_end = cur.end;
      cur.start = addOneDay(cur.start);
      cur.end = addOneDay(cur.end)-1; // subtract 1 to get last ms of ending day 
      return cur;
    });
    
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
  })();

  console.log('start');
  
  const in_directory = './in_csv';
  
  const energy_prices_v1 = await loadEnergyPrices(); 
  
  if( config.check_email === true ){
    const num_results = 3;
    await download_energy_report(in_directory, num_results);
  }
  
  const records_obj = await loadMeterData( in_directory );
  
  const date_list = Object.keys(records_obj).reduce(( acc, key )=>{
    const cur = records_obj[key];
    const time = cur.usage_date;
    if( acc.indexOf(time)<0 ){
      acc.push(time);
    }
    return acc;
  },[]);

  const energy_prices_v2 = await downloadPricingHistoryArr( date_list );
  const energy_prices = {...energy_prices_v1, ...energy_prices_v2};

  const production_obj = await getProductionContent( date_list );

  addRawProduction( records_obj, production_obj )
  addTotalUsage(records_obj);
  invertField(records_obj, 'consumption');
  addBillPeriod(records_obj, bill_periods);
  addPrice(records_obj, energy_prices);
  addTotalChargeNoTax(records_obj);
  
  // TODO move out of this function block 
  async function writeRecordsCSVandJSON({records_obj, start, end, dir, name}){
    const csv_path = `${dir}/${name}.csv`;
    const json_path = `${dir}/${name}.json`;

    const cur_records_obj = await getRecordsRange({records_obj, start, end});
        
    let final_arr = getCSVArr(cur_records_obj);
    const csv_content = stringify(final_arr);

    return await Promise.all([
      await fs.writeFile( csv_path , csv_content ),
      await fs.writeFile( json_path , JSON.stringify(cur_records_obj,null,2) ),
    ])
  }

  // write with all data 
  await writeRecordsCSVandJSON({
    dir:"./out",
    name:'all',
    records_obj, 
    start:0, 
    end:(new Date('Jan 01 3024').getTime()),
  });

  // bill_periods
  const to_wait = bill_periods.map(async(cur)=>{

    const name = getSimpleMonth(cur.end);

    const cur_records_obj = await getRecordsRange({records_obj, start:cur.start, end:cur.end});

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
    const gross_usage = await (async()=>{      
      let to_return = new Decimal(0);
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].total_usage===undefined){
          throw new Error(`cur_records_obj[k].total_usage is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k].total_usage));
      }
      return to_return.toNumber();
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
        to_return = (new Decimal(to_return).add(cur_records_obj[k].raw_production));
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

    const avg_earned = new Decimal(total_credit_earned).dividedBy(total_surplus_generation).toNumber();
    
    // sum of total_usage + sum of raw_production // tells you if you're consuming or producing more 
    const gross_consumption = new Decimal(gross_usage).add(total_raw_production).toNumber();
    
    const gross_spend = new Decimal(total_credit_earned).add(total_spend).toNumber();

    const gross_receipt_tax_reimbursement_price = new Decimal(GROSS_RECEIPT_TAX_REIMBURSEMENT).times(total_charge_no_tax).toNumber();
    const pcu_rate_price = new Decimal(PCU_RATE).times(total_charge_no_tax).toNumber();

    const total_charge = 
      new Decimal(gross_receipt_tax_reimbursement_price)
      .add(pcu_rate_price)
      .add(total_charge_no_tax)
      .add(total_credit_earned) // add earned after calculating price of taxes // positive is in your favor 
      .toNumber();

    // create csv and json
    await writeRecordsCSVandJSON({
      dir:"./out",
      name,
      records_obj, 
      start: cur.start, 
      end: cur.end,
    }); 

    return {
      times:{
        period_start: new Date(cur.start).toString(),
        period_end: new Date(cur.end).toString(),
        earliest_record: earliest_obj.usage_time,
        latest_record: latest_obj.usage_time,
      },
      info: {
        production_info: {
          'consuming or producing more: gross_consumption': gross_consumption,
          'used from both sources: gross_usage': gross_usage,
          "raw production": total_raw_production,
        },
        bill: {
          "taken from grid: total_consumption": total_consumption,
          "sent to grid: total_surplus_generation": total_surplus_generation,
          "bill credit earned: total_credit_earned": total_credit_earned,
          "tax1 gross_receipt_tax_reimbursement": gross_receipt_tax_reimbursement_price,
          "tax2 pcu_rate": pcu_rate_price,
          "energy provider charge: total_energy_charge": total_energy_charge,
          "oncor charge: total_oncor_price": total_oncor_price,
          "ercot charge: total_ercot_price_rounded": total_ercot_price_rounded,
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
  });

  const report = await Promise.all(to_wait); 

  if( config.print_bill_period_results === true ){
    report.forEach(c=>console.log(c));
    // console.log(report);
  }

  console.log('done');
  
})();

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

    records_obj[k].spend = bill_energy_price.times(records_obj[k]['consumption']);

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

async function getRecordsRange({records_obj, start, end }){
  const to_return = {};
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


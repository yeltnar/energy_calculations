import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs/promises';
import config from 'config';

import download_energy_report from './download_energy_report.js';
import {getProductionContent} from './getProductionContent.js'
import {loadEnergyPrices, downloadPricingHistoryArr} from './loadEnergyPrices.js'
import Decimal from 'decimal.js';

// TODO make dynamic
const ENERGY_PRICE = new Decimal('0.1364637826');

const bill_periods = (()=>{

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

  // fix bill periods to real periods 
  const periods = config.bill_periods.map((cur)=>{
    cur.start = addOneDay(cur.start);
    cur.end = addOneDay(cur.end)-1; // subtract 1 to get last ms of ending day 
    return cur;
  });

  return periods;
})();

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
  addPrice(records_obj, energy_prices);
  addBillPeriod(records_obj, bill_periods);
  
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

    const total_earned = await (async()=>{      
      let to_return = 0;
      for (let k in cur_records_obj ){
        to_return = (new Decimal(to_return).add(cur_records_obj[k].earned)).toNumber();
        if(  Number.isNaN(to_return) ){
          throw new Error(`found NaN\n${JSON.stringify({
            earned: cur_records_obj[k].earned,
            k,
            date: new Date(parseFloat(k)).toString(),
          },null,2)}`)
        }
      }
      return to_return;
    })();

    const oppo_earned = await (async()=>{
      let to_return = new Decimal(total_earned);
      for (let k in cur_records_obj ){
        to_return = to_return.add(cur_records_obj[k].saved);
        if(  Number.isNaN(to_return) ){
          throw new Error(`found NaN\n${JSON.stringify({
            saved: cur_records_obj[k].saved,
            k,
            date: new Date(parseFloat(k)).toString(),
          },null,2)}`)
        }
      }
      return to_return.toNumber();
      
    })();

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
        if(cur_records_obj[k].spend===undefined){
          throw new Error(`cur_records_obj[k].spend is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k].spend));
      }
      // to_return.add(9.95).add(3.59); // TODO factor in base charges 
      return to_return.toNumber();
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

    const avg_earned = new Decimal(total_earned).dividedBy(total_surplus_generation).toNumber();
    const gross_consumption = new Decimal(gross_usage).add(total_raw_production).toNumber();
    const gross_spend = new Decimal(total_earned).add(total_spend).toNumber();

    if( config.print_bill_period_results === true ){
      console.log({
        period_start: new Date(cur.start).toString(),
        period_end: new Date(cur.end).toString(),
        earliest_record: earliest_obj.usage_time,
        latest_record: latest_obj.usage_time,
        gross_consumption,
        gross_usage,
        total_raw_production,
        total_consumption,
        total_surplus_generation,
        total_earned,
        oppo_earned,
        total_spend,
        gross_spend,
        avg_earned,
      });
    }

    // create csv and json
    await writeRecordsCSVandJSON({
      dir:"./out",
      name,
      records_obj, 
      start: cur.start, 
      end: cur.end,
    }); 

  });

  await Promise.all(to_wait); 

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

    const ms = records_obj[k].ms;
    const price_obj = energy_prices[ms];

    if( price_obj!==undefined ){
      records_obj[k].price = price_obj.settlement_point_price_dollar_kwh.toNumber();
      records_obj[k].price_uncapped = price_obj.settlement_point_price_dollar_kwh_uncapped.toNumber();
      records_obj[k].earned = price_obj.settlement_point_price_dollar_kwh.times(records_obj[k]['surplus_generation'] || 0).toNumber();
      if(null===records_obj[k].earned){
        throw new Error('bad');
      }
      records_obj[k].spend = ENERGY_PRICE.times(records_obj[k]['consumption']);

      // note: raw production is 0 regardless of if panels were recording or not, per the API 
      if( records_obj[k].surplus_generation !== undefined ){ // We want to only account for days when we have surplus generation data
        let meter_side_use = new Decimal(records_obj[k].raw_production).minus(records_obj[k].surplus_generation).toNumber();
        meter_side_use = meter_side_use < 0 ? 0 : meter_side_use; // if the meter and solar generation disagree, force to zero (likely close any way)
        records_obj[k].meter_side_use = meter_side_use;
        records_obj[k].saved = ENERGY_PRICE.times(meter_side_use);
      }else{
        records_obj[k].saved = 0;
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
  }
  return records_obj;
}

function addBillPeriod(records_obj, bill_periods){

  for( let k in records_obj){
    const record = records_obj[k];

    // this logic will only take the latest bill period on the records object 
    bill_periods.forEach(( bill_period )=>{
      // if( record.ms >= bill_period.start && record.ms < bill_period.end ){
      if( bill_period.start < record.ms && record.ms <= bill_period.end ){
        // console.log(`${record.usage_time} --- ${bill_period.start} - ${record.ms} - ${bill_period.end}`);
        bill_period.d = bill_period.d || [];
        bill_period.d.push(record);
        record.bill_period = bill_period.end; // maybe use start... use start everywhere else but not for bill periods 
      }
    });
    
  }
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



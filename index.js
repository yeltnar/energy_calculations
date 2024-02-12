import assert from 'node:assert';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs/promises';

import download_energy_report from './download_energy_report.js';
import {getProductionContent} from './getProductionContent.js'
import {loadEnergyPrices} from './loadEnergyPrices.js'
import Decimal from 'decimal.js';

const ENERGY_PRICE = new Decimal('0.1364637826');

const bill_periods = (()=>{

  // start dates should be the day after cuz they don't look at the that day
  // end dates should be the day after finish so math works out 
  const periods = [
    {
      start: new Date('November 16, 2023').getTime(),
      end: new Date('December 16, 2023').getTime(), 
    },
    {
      start: new Date('December 17, 2023').getTime(),
      end: new Date('Jan 19, 2024').getTime(), 
    },
    {
      start: new Date('Jan 20, 2024').getTime(),
      end: new Date('Feb 20, 2024').getTime(), 
    }
  ];

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

  const energy_prices = await loadEnergyPrices(); 

  // TODO add back 
  const num_results = 3;
  await download_energy_report(in_directory, num_results);
  const records_obj = await loadMeterData( in_directory, energy_prices );

  
  const date_list = Object.keys(records_obj).reduce(( acc, key )=>{
    const cur = records_obj[key];
    const time = cur.usage_date;
    if( acc.indexOf(time)<0 ){
      acc.push(time);
    }
    return acc;
  },[]);

  const production_obj = await getProductionContent( date_list );

  addRawProduction( records_obj, production_obj )
  addTotalUsage(records_obj);
  invertField(records_obj, 'Consumption');
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

    const total_earned = await (async()=>{      
      const cur_records_obj = await getRecordsRange({records_obj, start:cur.start, end:cur.end});
      let to_return = 0;
      for (let k in cur_records_obj ){
        to_return = (new Decimal(to_return).add(cur_records_obj[k].earned)).toNumber()
      }
      return to_return;
    })();

    const total_consumption = await (async()=>{      
      const cur_records_obj = await getRecordsRange({records_obj, start:cur.start, end:cur.end});
      let to_return = 0;
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].Consumption===undefined){
          throw new Error(`cur_records_obj[k].Consumption is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k].Consumption));
      }
      return to_return.toNumber();
    })();

    const total_total_usage = await (async()=>{      
      const cur_records_obj = await getRecordsRange({records_obj, start:cur.start, end:cur.end});
      let to_return = 0;
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].total_usage===undefined){
          throw new Error(`cur_records_obj[k].total_usage is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k].total_usage));
      }
      return to_return.toNumber();
    })();

    const total_surplus_generation = await (async()=>{      
      const cur_records_obj = await getRecordsRange({records_obj, start:cur.start, end:cur.end});
      let to_return = 0;
      for (let k in cur_records_obj ){
        if(cur_records_obj[k]['Surplus Generation']===undefined){
          throw new Error(`cur_records_obj[k]['Surplus Generation'] is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k]['Surplus Generation']));
      }
      return to_return.toNumber();
    })();

    const total_raw_production = await (async()=>{      
      const cur_records_obj = await getRecordsRange({records_obj, start:cur.start, end:cur.end});
      let to_return = 0;
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].raw_production===undefined){
          throw new Error(`cur_records_obj[k].raw_production is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k].raw_production));
      }
      return to_return.toNumber();
    })();

    const total_spend = await (async()=>{      
      const cur_records_obj = await getRecordsRange({records_obj, start:cur.start, end:cur.end});
      let to_return = 0;
      for (let k in cur_records_obj ){
        if(cur_records_obj[k].spend===undefined){
          throw new Error(`cur_records_obj[k].spend is undefined`);
        }
        to_return = (new Decimal(to_return).add(cur_records_obj[k].spend));
      }
      // to_return.add(9.95).add(3.59); // TODO factor in base charges 
      return to_return.toNumber();
    })();

    const gross_consumption = new Decimal(total_total_usage).add(total_raw_production).toNumber();
    const gross_spend = new Decimal(total_earned).add(total_spend).toNumber();

    console.log({
      period_ending: new Date(cur.end).toString(),
      gross_consumption,
      total_total_usage,
      total_raw_production,
      total_consumption,
      total_surplus_generation,
      total_earned,
      total_spend,
      gross_spend,
    });

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
    records_obj = {...records_obj, ...local_records_obj};
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
    const type = c.CONSUMPTION_SURPLUSGENERATION;

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
    records_obj[key].usage_date = `${arr[2]}-${arr[0]}-${arr[1]}`;
  });

  for( let key in records_obj){

    if( records_obj[key]._og_data === undefined ){
      console.error('aa!!!');
      process.exit(-1);
    }
    if( records_obj[key]._og_data['Surplus Generation'] === undefined ){
      // fill in 0 production if needed 
      records_obj[key]._og_data['Surplus Generation'] = JSON.parse(JSON.stringify(records_obj[key]._og_data['Consumption']));
      records_obj[key]._og_data['Surplus Generation'].CONSUMPTION_SURPLUSGENERATION = 'Surplus Generation';
      records_obj[key]._og_data['Surplus Generation'].REVISION_DATE = 'NA';
      records_obj[key]._og_data['Surplus Generation'].USAGE_KWH = "0";
      records_obj[key]._og_data['Surplus Generation'].ESTIMATED_ACTUAL = 'A';
      records_obj[key]['Surplus Generation'] = 0;
    }
  }
  return records_obj;
}

function addRawProduction( records_obj, production_obj ){

  for( let k in records_obj ){
    // divide by 1000 to convert to KWh 
    const production = production_obj[k].value;
    if(!production && production!==0){
      console.error({production});
      console.log('production is zero');
    }
    records_obj[k].raw_production = new Decimal(production).dividedBy(1000).toNumber(); 
  }

  return records_obj;
}

function addTotalUsage(records_obj){

  for( let k in records_obj ){
    const c = records_obj[k];
    c.total_usage = new Decimal(c.raw_production)
      .times(-1)
      .add( c['Surplus Generation'] || 0 )
      .sub( c['Consumption'] || 0 )
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
      records_obj[k].earned = price_obj.settlement_point_price_dollar_kwh.times(records_obj[k]['Surplus Generation']).toNumber();
      // TODO read this from dynamic location 
      records_obj[k].spend = ENERGY_PRICE.times(records_obj[k]['Consumption']);
    }else{
      console.error({
        msg:'price undefined',
        o: records_obj[k].usage_time,
      })
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

  let column_headers = ['ms', 'usage_time', 'surplus_generation', 'consumption', 'raw_production', 'total_usage', 'earned', 'price_uncapped', 'price'];
  let key_values = ['ms', 'usage_time', 'Surplus Generation', 'Consumption', 'raw_production', 'total_usage', 'earned', 'price_uncapped', 'price'];
  let final_arr = [];
  for ( let k in records_obj){
    const new_record = []; // line starts with the ms line 
    
    key_values.forEach((c)=>{
      let to_push = records_obj[k][c];
      
      if(c==='Surplus Generation' && to_push===undefined){
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



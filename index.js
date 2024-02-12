import assert from 'node:assert';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs/promises';

import download_energy_report from './download_energy_report.js';
import {getProductionContent} from './getProductionContent.js'
import {loadEnergyPrices} from './loadEnergyPrices.js'
import Decimal from 'decimal.js';

const bill_periods = (()=>{

  // end dates should be the day after finish so math works out 
  const periods = [
    {
      start: new Date('November 16, 2023').getTime(),
      end: new Date('December 16, 2023').getTime(), // not sure why the dates overlap... maybe due to first bill 
    },
    {
      start: new Date('December 16, 2023').getTime(),
      end: new Date('Jan 18, 2024').getTime(), 
    },
    {
      start: new Date('Jan 18, 2024').getTime(),
      end: new Date('Feb 19, 2024').getTime(), 
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

  const date_ms_list = Object.keys(records_obj);
  
  const production_obj = await getProductionContent( date_ms_list );

  addRawProduction( records_obj, production_obj )
  addTotalUsage(records_obj);
  invertField(records_obj, 'Consumption');
  addPrice(records_obj, energy_prices);
  addBillPeriod(records_obj, bill_periods);
  // invertField(records_obj, 'Surplus Generation');

  await fs.writeFile('/tmp/large.json',JSON.stringify(records_obj,null,2));

  throw new Error(`need to write to disk again. look below `);

  (()=>{
  
    // get simple date from smallest date 
    const date_ms = parseInt(Object.keys(records_obj).sort()[0]);
    const formatted_date = getSimpleMonth(date_ms);
    
    let final_arr = getCSVArr(records_obj);
    
    // remove ms from final CSV
    final_arr.forEach(c=>{
      c.shift();
    });
    
    // const date = getSimpleMonth(final_arr[1][0]);
    fs.mkdir(`${out_directory}`).catch(()=>{});
    const out_file = `${out_directory}/final_${formatted_date}.csv`;
    // console.log(`writing to ${out_file}`);
    const csv_content = stringify(final_arr);
    fs.writeFile( `${out_file}` , csv_content );
  })();


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
    records_obj[key].usage_date = c.USAGE_DATE;
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
      records_obj[k].earned = price_obj.settlement_point_price_dollar_kwh.times(records_obj[k]['Surplus Generation']).toNumber();
    }else{
      console.error({
        msg:'price undefined',
        o: records_obj[k].usage_time,
      })
      records_obj[k].price = NaN;
      records_obj[k].earned = NaN;
      
    }
  }
  return records_obj;
}

function addBillPeriod(records_obj, bill_periods){

  for( let k in records_obj){
    const record = records_obj[k];

    // this logic will only take the latest bill period on the records object 
    bill_periods.forEach(( bill_period )=>{
      if( record.ms >= bill_period.start && record.ms < bill_period.end ){
        // console.log(`${record.usage_time} --- ${bill_period.start} - ${record.ms} - ${bill_period.end}`);
        bill_period.d = bill_period.d || [];
        bill_period.d.push(record);
        record.bill_period = bill_period.end; // maybe use start... use start everywhere else but not for bill periods 
      }
    });
    
  }
}

function getCSVArr(records_obj){

  let column_headers = ['ms', 'usage_time', 'surplus_generation', 'consumption', 'raw_production', 'total_usage', 'earned', 'price'];
  let key_values = ['ms', 'usage_time', 'Surplus Generation', 'Consumption', 'raw_production', 'total_usage', 'earned', 'price'];
  let final_arr = [column_headers];
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

  return final_arr;
}



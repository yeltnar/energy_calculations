import assert from 'node:assert';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs/promises';

import download_energy_report from './download_energy_report.js';

import {getProductionContent} from './getProductionContent.js'

function timeoutPromise(ms){
  return new Promise((resolve, reject)=>{
    setTimeout(resolve,ms);
  }); 
}


const out_directory = "./out";

async function getMeterContent( file_path = process.argv[2] ){
  // console.log(`file_path is ${file_path}`);
  return (await fs.readFile(file_path)).toString(); 
}

async function processSingleFile( file_path ){

  const input = await getMeterContent( file_path );

  let records = parse(input, {
    columns: true,
    skip_empty_lines: true
  });

  // very coupled 
  removeDoubleSpaces(records);

  const records_obj = listToObjSupplementData(records);
  
  // get simple date from smallest date 
  const date_ms = parseInt(Object.keys(records_obj).sort()[0]);
  const formatted_date = getSimpleMonth(date_ms)
  
  const production_obj = await getProductionContent(date_ms);

  addRawProduction( records_obj, production_obj )
  addTotalUsage(records_obj);
  invertField(records_obj, 'Consumption');
  // invertField(records_obj, 'Surplus Generation');

  let final_arr = getCSVArr(records_obj);
  
  // remove ms from final CSV
  final_arr.forEach(c=>{
    c.shift();
  });
  
  // const date = getSimpleMonth(final_arr[1][0]);
  fs.mkdir(`${out_directory}`).catch(()=>{});
  const out_file = `${out_directory}/final_${formatted_date}.csv`;
  // console.log(`writing to ${out_file}`);
  fs.writeFile( `${out_file}` ,stringify(final_arr) );

}

(async()=>{

  console.log('start');
  
  const in_directory = './in_csv';

  await download_energy_report(in_directory);


  let csv_list = await fs.readdir(in_directory);
  csv_list = csv_list.reduce((acc,c)=>{
    if(/.csv$/i.test(c)){
      acc.push(c);
    }
    return acc;
  },[]);

  for( let i=0; i<csv_list.length; i++ ){
    const file_path = `${in_directory}/${csv_list[i]}`;
    await processSingleFile( file_path ).catch(e=>{
      console.error(e);
      throw new Error(`error parsing file: ${csv_list[i]}`);
    });
  }

  console.log('done');
  
})();

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
function removeDoubleSpaces(records){
  records.forEach(c=>{
    c.USAGE_TIME = `${c.USAGE_DATE} ${c.USAGE_END_TIME}`;
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

    records_obj[key][type] = parseFloat(c.USAGE_KWH);

  });

  return records_obj;
}

function addRawProduction( records_obj, production_obj ){

  for( let k in records_obj ){
    // divide by 1000 to convert to KWh 
    records_obj[k].raw_production = production_obj[k].value / 1000; 
  }

  return records_obj;
}

function addTotalUsage(records_obj){

  for( let k in records_obj ){
    const c = records_obj[k];
    c.total_usage = (-1 * c.raw_production) + c['Surplus Generation'] - c['Consumption'];
    // c.total_usage = (-1 * c.raw_production) + c['Consumption'];
  }

}

function invertField(records_obj, field){

  for( let k in records_obj ){
    records_obj[k][field] = records_obj[k][field] * -1;
  }

}

function getCSVArr(records_obj){

  let column_headers = ['ms', 'usage_time', 'surplus_generation', 'consumption', 'raw_production', 'total_usage'];
  let key_values = ['ms', 'usage_time', 'Surplus Generation', 'Consumption', 'raw_production', 'total_usage'];
  let final_arr = [column_headers];
  for ( let k in records_obj){
    const new_record = []; // line starts with the ms line 
    
    key_values.forEach((c)=>{
      new_record.push(records_obj[k][c]);      
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



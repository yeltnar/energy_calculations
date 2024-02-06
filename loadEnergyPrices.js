import { parse } from 'csv-parse/sync';
import fs from 'fs/promises';
import {getDailyEnergyPrice} from './getDailyEnergyPrice.js';
import suplimentRecord from './suplimentRecord.js';

// const file_path = './energy_prices/jan_LZ_NORTH.csv';
const historical_input_path = './energy_prices/historical/';
const daily_input_path = './energy_prices/daily';

export async function loadEnergyPrices(){

    let cur_price_obj = {};

    cur_price_obj = await getDailyEnergyPrice(daily_input_path, cur_price_obj);
    cur_price_obj = await loadHistoricalEnergyPrices(historical_input_path, cur_price_obj);

    fs.writeFile('/tmp/all_price.json',JSON.stringify(cur_price_obj));

    return cur_price_obj;
}

async function loadHistoricalEnergyPrices(historical_input_path, cur_price_obj){

    let files = await fs.readdir(historical_input_path);
    files = files.filter((cur)=>/csv$/.test(cur));
    
    for(let i=0; i<files.length; i++){
        const cur = files[i];
        cur_price_obj = await loadSingleHistoricalEnergyPrices(`${historical_input_path}/${cur}`, cur_price_obj);
    }

    return cur_price_obj;
}

async function loadSingleHistoricalEnergyPrices(file_path, obj_for_data){

    let csv = (await fs.readFile(file_path)).toString();
    let csv_arr = csv.split('\n');
    
    // fix column titles 
    csv_arr[0] = csv_arr[0].split(' ').join("_").toLowerCase();

    csv = csv_arr.join('\n');
    
    let records = parse(csv, {
        columns: true,
        skip_empty_lines: true
    });

    // records = suplimentRecord(record);


    records = records.map( suplimentRecord );

    records._from_history = true;

    // console.log(records.length)
    // console.log(records[0]);

    const to_return = records.reduce((acc,cur)=>{
        acc[cur.date_ms] = cur;
        return acc;
    },obj_for_data);

    // console.log(to_return);
    
    return to_return;
}
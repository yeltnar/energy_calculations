import { parse } from 'csv-parse/sync';
import fs from 'fs/promises';
import {getDailyEnergyPrice} from './getDailyEnergyPrice.js';

// const file_path = './energy_prices/jan_LZ_NORTH.csv';
const historical_input_path = './energy_prices/historical/';
const daily_input_path = './energy_prices';

export async function loadEnergyPrices(){
    return await loadHistoricalEnergyPrices(historical_input_path);
}

export async function loadHistoricalEnergyPrices(historical_input_path){

    let files = await fs.readdir(historical_input_path);
    files = files.filter((cur)=>/csv$/.test(cur));
    console.log(files);

    let to_return = {};
    
    for(let i=0; i<files.length; i++){
        const cur = files[i];
        to_return = await loadSingleHistoricalEnergyPrices(`${historical_input_path}/${cur}`, to_return);
    }

    return to_return;
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

    records = records.map((cur)=>{

        let hr = cur.delivery_hour-1;
        if( hr < 10 ){
            hr = "0"+hr;
        }else{
            hr = ""+hr;
        }

        let min = (cur.delivery_interval-1)*15;
        if( min < 10 ){
            min = "0"+min;
        }else{
            min = ""+min;
        }

        cur.date_str = `${cur.delivery_date} ${hr}:${min}`;
        cur.date = new Date(cur.date_str);
        cur.date_ms = cur.date.getTime();
        cur.date_formatted = cur.date.toString();

        cur.settlement_point_price_dollar_kwh = cur.settlement_point_price / 1000;

        return cur;
    });

    // console.log(records.length)
    console.log(records[0]);

    const to_return = records.reduce((acc,cur)=>{
        acc[cur.date_ms] = cur;
        return acc;
    },obj_for_data);

    console.log(to_return);
    
    return to_return;
}
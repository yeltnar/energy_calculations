// /private/tmp/xml-js/index.js

import {parse as htmlParse} from 'node-html-parser';
// const {parse: csvParse} = require('csv-parse/sync');
// const { stringify } = require('csv-stringify/sync');
import fs from 'fs/promises';
import Decimal from 'decimal.js';
import suplimentRecord from './suplimentRecord.js';

const DESIRED_ZONE = 'LZ_NORTH';

// I'm lazy // maps interval ending to minute count format 
const INTERVAL_ENDING_MIN_MAP = {
    '00': 4,
    '15': 1,
    '30': 2,
    '45': 3,
};

export async function getDailyEnergyPrice(daily_input_path, cur_price_obj){
    let to_return = await readDailyEnergyCSV(daily_input_path);
    to_return = to_return[DESIRED_ZONE].reduce((acc,cur)=>{
        acc[cur.date_ms] = cur;
        return acc;
    },cur_price_obj);
    return to_return;
}
async function readDailyEnergyCSV(daily_input_path){
    let html_files = await fs.readdir(daily_input_path);

    html_files = html_files.filter(c=>/\.html$/i.test(c));

    if(html_files.length===0){
        throw new Error('no files found; exiting');
    }

    let report_obj;

    for( let k in html_files ){
        const file = html_files[k];
        report_obj = await getDailyReportObj(`${daily_input_path}/${file}`, report_obj);
    }

    // const file_path = 'html/20231225.html';

    return report_obj;

}

async function getDailyReportObj(file_path, report_obj={}){        

    let html = (await fs.readFile(file_path)).toString();
    const root = htmlParse(html);
    const table = root.querySelectorAll('table');
    const tr = root.querySelectorAll('tr');
    
    const csv_arr = tr.map((row)=>{

        const td = row.querySelectorAll('th,td'); // grab the header and data

        return td.map((data)=>{
            return data.innerText;
        });
    });

    report_obj = csv_arr.reduce((acc, cur_row, row_index)=>{

        if( row_index===0 ){
            cur_row.forEach(( cur, column_index )=>{
                if( column_index===0 || column_index===1 ){return} // don't add metadata columns
                // if(cur!==DESIRED_ZONE){return;} // only deal with my zone 
                if( acc[cur]===undefined ){
                    acc[cur] = [];
                }
            });
        }else{
            const new_data = cur_row.forEach((cur, i, row_arr)=>{
                if( i===0 || i===1 ){return} // don't add metadata columns
                const key = csv_arr[0][i]; // this is the zone

                // if (key!==DESIRED_ZONE){return;} // only deal with my zone 

                const delivery_date = row_arr[0];
                const interval_ending = /[0-9]{4}/.exec(row_arr[1])[0]; 


                if( interval_ending.includes('*') ){
                  throw new Error('* is not a date'); 
                }

                
                let  delivery_min = /.{2}$/.exec(interval_ending)[0];
                let  delivery_interval = INTERVAL_ENDING_MIN_MAP[delivery_min];
                let  delivery_hour = parseInt(/.{2}/.exec(interval_ending)[0]);
                if(delivery_interval!==4){
                    delivery_hour++; // add an hour if in first 3 'ending' segments, but not fourth
                }

                let settlement_point_price = new Decimal(cur);
                const settlement_point_price_dollar_kwh_uncapped = settlement_point_price.dividedBy(1000);
                let settlement_point_price_dollar_kwh = settlement_point_price.dividedBy(1000);

                let data = {
                    delivery_date,
                    delivery_hour,
                    delivery_interval,
                    settlement_point_name: DESIRED_ZONE,
                    settlement_point_price,
                    settlement_point_price_dollar_kwh,
                    settlement_point_price_dollar_kwh_uncapped,
                    _src_data:{
                        delivery_date,
                        interval_ending,
                    }
                };

                // This is where we cap the price at 25 cents
                data = suplimentRecord(data, 'price', file_path);

                acc[key].push(data);

                // console.log(acc);
                return 
                csv_arr[0][i];
            });
            // process .exit();
            // acc.pu
        }

        return acc;

    },report_obj);

    return report_obj;

}

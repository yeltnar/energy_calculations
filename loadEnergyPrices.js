import { parse } from 'csv-parse/sync';
import fs from 'fs/promises';
import {getDailyEnergyPrice} from './getDailyEnergyPrice.js';
import suplimentRecord from './suplimentRecord.js';
import axios from 'axios';
import Decimal from 'decimal.js';

// const file_path = './energy_prices/jan_LZ_NORTH.csv';
const historical_input_path = './energy_prices/historical/';
const daily_input_path = './energy_prices/daily';

export async function downloadPricingHistoryArr( date_list ){

    const wait_list = date_list.map(async(cur)=>{
        const r = await downloadPricingHistory( { deliveryDateFrom:cur, deliveryDateTo:cur } );
        return r;
    });

    let x = await Promise.all(wait_list);    
    x = x.reduce((acc,row)=>{
        row.forEach(( c )=>{
            let settlement_point_price = new Decimal(c.settlementPointPrice);
            const settlement_point_price_dollar_kwh_uncapped = settlement_point_price.dividedBy(1000);
            let settlement_point_price_dollar_kwh = settlement_point_price.dividedBy(1000);

            let data = {
                delivery_date: c.deliveryDate,
                delivery_hour: c.deliveryHour,
                delivery_interval: c.deliveryInterval,
                settlement_point_name: c.settlementPoint,
                settlement_point_price: c.settlementPointPrice,
                settlement_point_price_dollar_kwh,
                settlement_point_price_dollar_kwh_uncapped,
            };
            data = suplimentRecord(data);
            // console.log(data);
            // process.exit();
            acc[data.date_ms] = data;
        });
        return acc;
    },{});

    return x;
}

async function downloadPricingHistory({ deliveryDateFrom, deliveryDateTo }){
    
    const settlementPoint = "LZ_NORTH";
    const settlementPointType = "LZ";

    const cur_arr = await downloadSinglePricingHistoryCached({ deliveryDateFrom, deliveryDateTo, settlementPoint, settlementPointType });
    // console.log(cur_arr.length);
    return cur_arr;
}

const cache_dir = `./energy_prices/tmp`;
async function downloadSinglePricingHistoryCached({ deliveryDateFrom, deliveryDateTo, settlementPoint, settlementPointType, page=1 }){

    // console.log(`downloadSinglePricingHistoryCached page ${page}`)

    const file_path = `${cache_dir}/${deliveryDateFrom}_${deliveryDateTo}_${page}.json`;

    let raw_ercot_data;
    try{
        raw_ercot_data = JSON.parse((await fs.readFile(file_path)).toString());
    }catch(e){
        console.log(`downloading for ${file_path}`);
        raw_ercot_data = await downloadSinglePricingHistory({ deliveryDateFrom, deliveryDateTo, settlementPoint, settlementPointType, page  });
        await fs.writeFile(file_path, JSON.stringify(raw_ercot_data) );
        console.log(`wrote to ${file_path}`);
    }

    const {currentPage, totalPages} = raw_ercot_data._meta

    let to_return = dataToObj( raw_ercot_data );

    if( currentPage < totalPages ){
        page = currentPage+1;
        const new_arr = await downloadSinglePricingHistoryCached({ deliveryDateFrom, deliveryDateTo, settlementPoint, settlementPointType, page })
        to_return = [...to_return, ...new_arr];
    }

    return to_return;
}

function dataToObj( in_data ){
    const { fields, data } = in_data;

    let to_return = data.map(( cur_row )=>{
        const to_return = {};
        cur_row.forEach(( cur_column, i, arr )=>{
            const {name} = fields[i];
            to_return[name] = cur_column;
        });
        return to_return;
    });

    // API won't remove LZEW or whatever 
    to_return = to_return.filter(cur=>cur.settlementPointType==='LZ');

    return to_return;
}

let pricing_que = [];
async function downloadSinglePricingHistory({ deliveryDateFrom, deliveryDateTo, settlementPoint, settlementPointType, page  }){

    if( page===undefined ){
        throw new Error('currentPage undefined: downloadSinglePricingHistory')
    }

    const base = `https://api.ercot.com/api/public-reports/np6-905-cd/spp_node_zone_hub`;

    const url = `${base}?deliveryDateFrom=${deliveryDateFrom}`
                +`&deliveryDateTo=${deliveryDateTo}`
                +`&settlementPointType=${settlementPointType}`
                +`&settlementPoint=${settlementPoint}`
                +`&page=${page}`

    let x; 
    try{
        await Promise.all(pricing_que);
        const new_promise = axios.get(url);
        pricing_que.push(new_promise);
        x = (await new_promise).data;
    }catch(e){
        console.error({url});
        await fs.writeFile('/tmp/axios_error',e.toString());
        throw new Error('axios error downloading ercot data');
    }

    return x;
}

export async function loadEnergyPrices(){

    let cur_price_obj = {};

    cur_price_obj = await getDailyEnergyPrice(daily_input_path, cur_price_obj);
    cur_price_obj = await loadHistoricalEnergyPrices(historical_input_path, cur_price_obj);


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
    let csv_arr = csv.split('\r').join();
    csv_arr = csv.split('\n');
    
    await fs.writeFile("/tmp/records.tmp",csv);
    
    // fix column titles 
    csv_arr[0] = csv_arr[0].split(' ').join("_").toLowerCase();

    // for some reason im getting non printable chars 
    csv_arr[0] = [...csv_arr[0]].reduce((acc,cur,i,arr)=>{
        const code = cur.charCodeAt();
        if(code<60000){
            acc.push(cur);
        }
        return acc;
    },[]).join("");

    csv = csv_arr.join('\n');
    
    let records = parse(csv, {
        columns: true,
        skip_empty_lines: true
    });


    records = records.map( suplimentRecord );

    records._from_history = true;

    const to_return = records.reduce((acc,cur)=>{
        acc[cur.date_ms] = cur;
        return acc;
    },obj_for_data);

    // console.log(to_return);
    
    return to_return;
}
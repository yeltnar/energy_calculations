import fs from 'fs/promises';
import axios from 'axios';
import config from 'config';

const cache_directory = './production_content';

fs.mkdir(`${cache_directory}`).catch(()=>{});

const site = config.site;
const api_key = config.api_key; 

export async function getProductionContent(date_ms){

    // console.log(date_ms);
    
    const { year, month, day } = getMonthDeats(date_ms)

    // TODO validate the month works 

    // const startTime = `${year}-${month}-${day}%2000:00:00`;
    // const endTime = `${year}-${month}-${day}%2023:49:00`;
    const startTime = `${year}-${month}-${day}`;
    const endTime = `${year}-${month}-${day}`;

    const production_content = await requestProductionContent(site, api_key, startTime, endTime);
    
    // console.log(production_content);

    const production = production_content.energy.values;
    
    const production_obj = {};
    production.forEach((c)=>{
      c.ms = new Date(c.date).getTime();
      if(c.value===null){
        c.value = 0;
      }else{
        c.value = parseFloat(c.value);
      }
      production_obj[c.ms] = c;
    });
  
    return production_obj;
  } 

function timeoutPromise(ms){
    return new Promise((resolve, reject)=>{
        setTimeout(resolve,ms);
    }); 
}

async function requestProductionContent(site, api_key, startTime, endTime){

    let final_wait = (async()=>{})()

    let to_return = await getCachedProductionData(site, startTime, endTime);
    if( to_return === false ){

        const timeUnit="QUARTER_OF_AN_HOUR";

        console.log({
            msg:'new request', 
            site, 
            startTime, 
            endTime,
            unitTime: timeUnit
        });

        const url = `https://monitoringapi.solaredge.com/site/${site}/energy?timeUnit=${timeUnit}&api_key=${api_key}&startDate=${startTime}&endDate=${endTime}`;
        const _url = `https://do.andbrant.com`;
        to_return = (await axios.get(url)).data;
        // console.log(JSON.stringify(to_return))
        final_wait = timeoutPromise(500);
        await fs.writeFile(
            getCacheName(site, startTime, endTime), 
            JSON.stringify(to_return)
        );

    }else{
        console.log(`found cache ${startTime}`);
    }

    await final_wait; // wait for a bit so we don't get rate limited, if made network request
    return to_return;
}

async function getCachedProductionData(site, startTime, endTime){
    const cache_name = getCacheName(site, startTime, endTime);
    return await fs.readFile(cache_name)
    .catch((e)=>{
        return false
    })
    .then((d)=>{
        return JSON.parse(d);
    });
}

function getCacheName(site, startTime, endTime){

    if (site === undefined || startTime === undefined || endTime === undefined){
        throw new Error('need to define, Yeltnar');
    }

    return `${cache_directory}/${site}_${startTime}_${endTime}`;
}


function getMonthDeats(date_var){

    const d = new Date(date_var);

    const year = d.getFullYear();
    const month = d.getMonth()+1;
    const day = d.getDate();

    if( Number.isNaN(year) ){
        throw new Error(`getMonthDeats parsed year is NaN. date_var is ${date_var}`);
    }
    if( Number.isNaN(month) ){
        throw new Error(`getMonthDeats parsed month is NaN. date_var is ${date_var}`);
    }
    if( Number.isNaN(day) ){
        throw new Error(`getMonthDeats parsed day is NaN. date_var is ${date_var}`);
    }

    return {
        year,
        month,
        day
    };
}
import fs from 'fs/promises';
import axios from 'axios'

const cache_directory = './production_content';

fs.mkdir(`${cache_directory}`).catch(()=>{});

const site = process.env.site;
const api_key = process.env.api_key; 

export async function getProductionContent(date_ms){

    console.log(date_ms);
    
    const { year, month, day } = getMonthDeats(date_ms)

    // TODO validate the month works 

    const startTime = `${year}-${month}-${day}%2000:00:00`;
    const endTime = `${year}-${month}-${day}%2023:49:00`;

    const production_content = await requestProductionContent(site, api_key, startTime, endTime);
    // console.log(production_content);

    const production = production_content.power.values;
    
    // process.exit();
    // const production = JSON.parse((await (fs.readFile('./content.json'))).toString()).power.values;
    
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

async function requestProductionContent(site, api_key, startTime, endTime){

    let to_return = await getCachedProductionData(site, startTime, endTime);
    if( to_return === false ){

        console.log('new request ', site, startTime, endTime)

        const url = `https://monitoringapi.solaredge.com/site/${site}/power?api_key=${api_key}&startTime=${startTime}&endTime=${endTime}`
        const _url = `https://do.andbrant.com`;
        to_return = (await axios.get(url)).data;
        // console.log(JSON.stringify(to_return))
        await fs.writeFile(
            getCacheName(site, startTime, endTime), 
            JSON.stringify(to_return)
        );

    }

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

    return {
        year,
        month,
        day
    };
}
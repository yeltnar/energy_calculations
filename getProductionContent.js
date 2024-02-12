import fs from 'fs/promises';
import axios from 'axios';
import config from 'config';

const cache_directory = './production_content';

fs.mkdir(`${cache_directory}`).catch(()=>{});

const site = config.site;
const api_key = config.api_key; 

// gets usage by day, caching requests as it goes 
export async function getProductionContent( date_str_list ){

    let production_obj = {};

    for( let i=0; i<date_str_list.length; i++ ){
        const date_str = date_str_list[i];

        const { year, month, day } = getMonthDeats(parseFloat(date_str))
        const startTime = date_str;
        const endTime = date_str;

        production_obj = await getSingleProductionContent({startTime, endTime, production_obj});
    }
  
    return production_obj;
  } 

const getSingleProductionContent = (() => {
    const cache_table = {};

    // we update production_obj and return it both
    return async function getSingleProductionContent({ startTime, endTime, production_obj }) {

        const cache_key = `${startTime}-${endTime}`;

        if( cache_table[cache_key] === undefined ){

            const production_content = await requestProductionContent(site, api_key, startTime, endTime);
    
            const production = production_content.energy.values;
    
            production.forEach((c) => {
                c.ms = new Date(c.date).getTime();
                if (c.value === null) {
                    c.value = 0;
                } else {
                    c.value = parseFloat(c.value);
                }
                production_obj[c.ms] = c;
            });

            cache_table[cache_key] = true;
        }

        return production_obj;
    }
})();



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
        throw new Error(`getMonthDeats parsed year is NaN. date_var is ${date_var} ${typeof date_var}`);
    }
    if( Number.isNaN(month) ){
        throw new Error(`getMonthDeats parsed month is NaN. date_var is ${date_var} ${typeof date_var}`);
    }
    if( Number.isNaN(day) ){
        throw new Error(`getMonthDeats parsed day is NaN. date_var is ${date_var} ${typeof date_var}`);
    }

    return {
        year,
        month,
        day
    };
}
import fs from 'fs/promises';
import axios from 'axios';
import config from 'config';

const cache_directory = './production_content';

fs.mkdir(`${cache_directory}`).catch(()=>{});

const site = config.site;
const api_key = config.api_key; 

// gets usage by day, caching requests as it goes 
export async function getProductionContent( {date_str_list, cache_type} ){

    if(cache_type===undefined){
        throw new Error('cache_type is undefined');
    }
    if(date_str_list===undefined){
        throw new Error('date_str_list is undefined');
    }

    let production_obj = {};

    for( let i=0; i<date_str_list.length; i++ ){
        const date_str = date_str_list[i];

        const { year, month, day } = getMonthDeats(parseFloat(date_str))
        const startTime = date_str;
        const endTime = date_str;

        production_obj = await getSingleProductionContent({startTime, endTime, production_obj, cache_type});
    }
  
    return production_obj;
  } 

const getSingleProductionContent = (() => {
    const cache_table = {};

    // we update production_obj and return it both
    return async function getSingleProductionContent({ startTime, endTime, production_obj, cache_type }) {

        if(cache_type===undefined){
            throw new Error('cache_type is undefined');
        }

        const cache_key = `${startTime}-${endTime}`;

        if( cache_table[cache_key] === undefined ){

            const {production_content,skip} = await requestProductionContent(site, api_key, startTime, endTime, cache_type);

            if(skip===false){
        
                const production = production_content[cache_type].values;
        
                production.forEach((c) => {
                    c.ms = new Date(c.date).getTime();
                    if (c.value === null) {
                        c.value = 0;
                    } else {
                        c.value = parseFloat(c.value);
                    }
                    production_obj[c.ms] = c;
                });

                // cache_table[cache_key] = true;
            }
        }

        return production_obj;
    }
})();

function timeoutPromise(ms){
    return new Promise((resolve, reject)=>{
        setTimeout(resolve,ms);
    }); 
}

async function requestProductionContent(site, api_key, startValue, endValue, cache_type){

    if(cache_type===undefined){
        throw new Error('cache_type is undefined');
    }

    if( site === undefined || site === '' ){
        throw new Error('site is undefined');
    }

    let final_wait = (async()=>{})()

    const use_network = config.site !== undefined && config.api_key !==undefined && config.check_solaredge!==false;
    let skip = false;

    let to_return = await getCachedProductionData(site, startValue, endValue, cache_type);
    if( to_return === false && use_network===true  ){

        const timeUnit="QUARTER_OF_AN_HOUR";

        console.log({
            msg:'new request', 
            site, 
            cache_type,
            startValue, 
            endValue,
            unitTime: timeUnit
        });

        let startKey = '';
        let endKey = '';
        let final_startValue = '';
        let final_endValue = '';

        if( cache_type === 'energy' ){
            
            startKey = 'startDate';
            endKey = 'endDate';

            final_startValue = startValue;
            final_endValue = endValue;

        }else if( cache_type === 'power' ){
            
            startKey = 'startTime';
            endKey = 'endTime';

            final_startValue = startValue+"%2000:00:00";
            final_endValue = endValue+"%2023:59:59";

        }

        const url = `https://monitoringapi.solaredge.com/site/${site}/${cache_type}?timeUnit=${timeUnit}&api_key=${api_key}&${startKey}=${final_startValue}&${endKey}=${final_endValue}`;
        const _url = `https://ip.andbrant.com`;

        to_return = (await axios.get(url)).data;
        // console.log(JSON.stringify(to_return))
        final_wait = timeoutPromise(500);
        await fs.writeFile(
            getCacheName(site, startValue, endValue, cache_type), 
            JSON.stringify(to_return)
        );

    }

    if( use_network === false && to_return === false){
        console.log({
            "msg": 'skipping network request',
            // site: config.site,
            // api_key: config.api_key,
            startValue, 
            endValue,
            check_solaredge: config.check_solaredge,
        })
        skip = true;
    }

    await final_wait; // wait for a bit so we don't get rate limited, if made network request
    return {
        production_content: to_return,
        skip,
    }
}

async function getCachedProductionData(site, startTime, endTime, cache_type){

    if (cache_type===undefined){
        throw new Error('cache_type is undefined');
    }

    const cache_name = getCacheName(site, startTime, endTime, cache_type);
    return await fs.readFile(cache_name)
    .catch((e)=>{
        return false
    })
    .then((d)=>{
        return JSON.parse(d);
    });
}

function getCacheName(site, startTime, endTime, cache_type){

    if( cache_type === undefined ){
        throw new Error('cache_type is undefined');
    }

    if (site === undefined || startTime === undefined || endTime === undefined){
        throw new Error('need to define, Yeltnar');
    }

    return `${cache_directory}/${site}_${cache_type}_${startTime}_${endTime}`;
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


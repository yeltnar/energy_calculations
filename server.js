import Koa from 'koa';
import koaRouter from 'koa-router';
import cors from '@koa/cors';
import { getInfoForRange, setupRecordsObj, fixBillPeriods, main } from './single_run.js';
const app = new Koa();
app.use(cors());

const PORT = 3000;

export function server(){
    console.log(`starting server on port ${PORT}`);

    const router = new koaRouter();

    app.use(async function (ctx, next) {
        console.log(ctx.url)
        await next();
    });

    router.get('all', /(\/api)?\/all/, async (ctx) => {
        const return_individual_data = ctx.request.query.i === 'true';
        let index = ctx.request.query.index;
        let results = await main({write:false, return_individual_data});
        if( index !==null && index !== undefined ){
            index = parseInt(ctx.request.query.index);
            results = results[index];
        }
        ctx.body = {
            results,
            index
        };
    });
    
    router.get('most_recent', /(\/api)?\/most_recent/, async (ctx) => {

        const most_recent_count = ctx.request.query.most_recent_count===undefined ? 1 : parseInt(ctx.request.query.most_recent_count); 

        let start = "0";
        let end = new Date().getTime();  
        
        const today = new Date();
        const today_ms = today.getTime();
        const start_ms = today_ms - (1000 * 60 * 60 * 24 * 20); // 20 days // this is a hard cap for most recent days 

        const default_value = {
            start,
            end,
            base_fee: 9.95,
            is_abstract: true,
        };
        
        let cur = {...default_value, ...ctx.request.query}
        cur = fixBillPeriods({cur, add_one_day:false, include_end_day:true});
        
        const records_obj = await setupRecordsObj();
        
        const return_individual_data = ctx.request.query.i === 'true';
        let results = await getInfoForRange( {records_obj, cur, return_individual_data, most_recent_count} ).catch((e)=>{console.error(e); return 'error with getInfoForRange; check data exsists for range'});
        
        ctx.body = {
            results,
        };
        
    });
    
    router.get('range', /(\/api)?\//, async (ctx) => {
        
        const default_value = {
            "start": "0",
            "end": new Date().getTime(),
            base_fee: 9.95,
            is_abstract: true,
        };
        
        let cur = {...default_value, ...ctx.request.query}
        cur = fixBillPeriods({cur, add_one_day:false, include_end_day:true});
        
        const records_obj = await setupRecordsObj();
        
        const return_individual_data = ctx.request.query.i === 'true';
        const results = await getInfoForRange( {records_obj, cur, return_individual_data} ).catch((e)=>{console.error(e); return 'error with getInfoForRange; check data exsists for range'});
        
        ctx.body = {
            results,
            // cur,
            // query: ctx.request.query,
        };
        
    });

    app.use(router.routes())
       .use(cors())
       .use(router.allowedMethods());

    app.listen(PORT);
}

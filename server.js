import Koa from 'koa';
import koaRouter from 'koa-router';
import { getInfoForRange, setupRecordsObj, fixBillPeriods, main } from './single_run.js';
const app = new Koa();

const PORT = 3000;

export function server(){
    console.log(`starting server on port ${PORT}`);

    const router = new koaRouter();
    
    router.get('range', '/', async (ctx) => {
        
        const default_value = {
            "start": "0",
            "end": new Date().getTime(),
            base_fee: 9.95,
            is_abstract: true,
        };
        
        let cur = {...default_value, ...ctx.request.query}
        cur = fixBillPeriods(cur);
        
        const records_obj = await setupRecordsObj();
        
        const results = await getInfoForRange( {records_obj, cur} ).catch(()=>'error with getInfoForRange; check data exsists for range');
        
        ctx.body = {
            results,
            // cur,
            // query: ctx.request.query,
        };
        
    });

    router.get('all', '/all', async (ctx) => {
        ctx.body = await main({write:false});
    });

    app.use(router.routes()).use(router.allowedMethods());

    app.listen(PORT);
}
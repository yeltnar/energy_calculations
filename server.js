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
    
    router.get('range', '/', async (ctx) => {
        
        const default_value = {
            "start": "0",
            "end": new Date().getTime(),
            base_fee: 9.95,
            is_abstract: true,
        };
        
        let cur = {...default_value, ...ctx.request.query}
        cur = fixBillPeriods(cur, false, true);
        
        const records_obj = await setupRecordsObj();
        
        const results = await getInfoForRange( {records_obj, cur} ).catch(()=>'error with getInfoForRange; check data exsists for range');
        
        ctx.body = {
            results,
            // cur,
            // query: ctx.request.query,
        };
        
    });

    router.get('all', '/all', async (ctx) => {
        ctx.body = {
            results: await main({write:false})
        };
    });

    app.use(router.routes())
       .use(cors())
       .use(router.allowedMethods());

    app.listen(PORT);
}
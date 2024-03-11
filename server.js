import Koa from 'koa';
import { getInfoForRange, setupRecordsObj, fixBillPeriods } from './single_run.js';
const app = new Koa();

const PORT = 3000;

export function server(){
    console.log(`starting server on port ${PORT}`);
    
    app.use(async (ctx) => {

        const default_value = {
            "start": "0",
            "end": new Date().getTime(),
            is_abstract: true,
        };

        let cur = {...default_value, ...ctx.request.query}
        cur = fixBillPeriods(cur);

        const records_obj = await setupRecordsObj();

        ctx.body = await getInfoForRange( records_obj, cur );

    });

    app.listen(PORT);
}
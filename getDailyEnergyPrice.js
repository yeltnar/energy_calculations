// /private/tmp/xml-js/index.js

const {parse: htmlParse} = require('node-html-parser');
// const {parse: csvParse} = require('csv-parse/sync');
// const { stringify } = require('csv-stringify/sync');
const fs = require('fs/promises');

const DESIRED_ZONE = 'LZ_NORTH';
const HTML_DIR = './html';

;(async()=>{
    const html_files = await fs.readdir(HTML_DIR);
    // console.log(JSON.stringify(html_files,null,2));
    // return

    if(html_files.length===0){
        throw new Error('no files found; exiting');
    }

    let report_obj;

    for( let k in html_files ){

        const file = html_files[k];

        if(/202(312|401(0|1[0-8])).*/.test(file)){
        // if(/20240122/.test(file)){
            console.log(file);
            report_obj = await getReportObj(`${HTML_DIR}/${file}`, report_obj);
        }
    }

    (()=>{

        function getToPrint( num ){
            
            if ( num < 10 ){
                num = "0"+num;
            }

            const r1 = new RegExp(`${num}[1-9]{1}[0-9]{1}`);
            const r2 = new RegExp(`${num+1}00`);

            return report_obj[DESIRED_ZONE].reduce((acc,cur)=>{
                if( r1.test(cur.interval_ending) || r2.test(cur.interval_ending) ){
                    acc.push(cur);
                }
                return acc;
            },[]);

        }


        for ( let i=0; i<24; i++ ){

            const to_print = getToPrint( i );

            const smol_avg_obj = to_print.reduce(( acc, cur )=>{
                acc = {
                    sum: parseFloat(cur.price) + acc.sum,
                    count: acc.count+1,
                }
                acc.avg = acc.sum / acc.count;
                return acc;
            },{sum:0,count:0,avg:0});
            // console.log(smol_avg_obj);

        }

    })();

    // const file_path = 'html/20231225.html';

    return console.log(report_obj);


    const avg_obj = report_obj[DESIRED_ZONE].reduce(( acc, cur )=>{
        acc = {
            sum: parseFloat(cur.price) + acc.sum,
            count: acc.count+1,
        }
        acc.avg = acc.sum / acc.count;
        return acc;
    },{sum:0,count:0,avg:0});

    console.log(avg_obj);

})();

async function getReportObj(file_path, report_obj={}){        

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

    report_obj = csv_arr.reduce((acc, cur, row_index)=>{

        if( row_index===0 ){
            cur.forEach(( cur, column_index )=>{
                if( column_index===0 || column_index===1 ){return} // don't add metadata columns
                if( acc[cur]===undefined ){
                    acc[cur] = [];
                }
            });
        }else{
            const new_data = cur.forEach((cur, i, row_arr)=>{
                if( i===0 || i===1 ){return} // don't add metadata columns
                const key = csv_arr[0][i];
                const time = row_arr[0];
                const interval_ending = row_arr[1];
                acc[key].push({
                    time,
                    interval_ending,
                    price: cur,
                });
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
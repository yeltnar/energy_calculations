import Decimal from 'decimal.js';
export default function suplimentRecord(cur){

        // return cur;

        let hr = cur.delivery_hour-1;
        if( hr < 10 ){
            hr = "0"+hr;
        }else{
            hr = ""+hr;
        }

        let min = (cur.delivery_interval-1)*15;
        if( min < 10 ){
            min = "0"+min;
        }else{
            min = ""+min;
        }

        const date_str = `${cur.delivery_date} ${hr}:${min}`;
        let date = new Date(date_str);
        const date_ms = date.getTime();
        const date_formatted = date.toString();

        if( !Decimal.isDecimal(cur.settlement_point_price) ){
            cur.settlement_point_price = new Decimal(parseFloat(cur.settlement_point_price));
        }
        // console.log(cur.settlement_point_price);
        // process.exit();

        cur.settlement_point_price_dollar_kwh = new Decimal(cur.settlement_point_price).dividedBy(1000);
        delete cur.settlement_point_type;
        delete cur.repeated_hour_flag;

        return {
            date_str,
            date,
            date_ms,
            date_formatted,
            ...cur
        };
    }
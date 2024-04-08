import Decimal from 'decimal.js';
export default function suplimentRecord(cur, kind){

        // return cur;

        let hr = cur.delivery_hour-1;
        if( hr < 10 ){
            hr = "0"+hr;
        }else{
            hr = ""+hr;
        }

        let min = (cur.delivery_interval-1)*15;
        if( Number.isNaN(min) ){
            if(kind!=='prediction'){
                throw new Error("we're not supposed to get NaN here");
            }
            min = '00'; 
        }else if( min < 10 ){
            min = "0"+min;
        }else{
            min = ""+min;
        }

        const date_str = `${cur.delivery_date} ${hr}:${min}`;
        let date = new Date(date_str);
        if( !(date instanceof Date) || isNaN(date) ){
            console.error(date_str);
            throw new Error('could not parse suplimentRecord date');
        }
        const date_ms = date.getTime();
        const date_formatted = date.toString();

        if( !Decimal.isDecimal(cur.settlement_point_price) ){
            cur.settlement_point_price = new Decimal(parseFloat(cur.settlement_point_price));
        }

        cur.settlement_point_price_dollar_kwh_uncapped = new Decimal(cur.settlement_point_price).dividedBy(1000);
        delete cur.settlement_point_type;
        delete cur.repeated_hour_flag;    
        
        cur.settlement_point_price_dollar_kwh = cur.settlement_point_price_dollar_kwh_uncapped > .25 ? new Decimal(.25) : cur.settlement_point_price_dollar_kwh_uncapped;

        return {
            date_str,
            date,
            date_ms,
            date_formatted,
            ...cur
        };
    }
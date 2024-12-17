import Decimal from 'decimal.js';
export default function suplimentRecord(cur, kind, file_path){

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
		console.log({
			file_path,
			cur,
			kind,
		});
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
            const no_comma = (cur.settlement_point_price).split(',').join('');
            cur.settlement_point_price = new Decimal(parseFloat(no_comma));
        }

        cur.settlement_point_price_dollar_kwh_uncapped = new Decimal(cur.settlement_point_price).dividedBy(1000);
        delete cur.settlement_point_type;
        delete cur.repeated_hour_flag;    

        if( cur.settlement_point_price_dollar_kwh_uncapped > .25 ){
            cur.settlement_point_price_dollar_kwh = new Decimal(.25);
        }else if( cur.settlement_point_price_dollar_kwh_uncapped < 0 ){
            cur.settlement_point_price_dollar_kwh = new Decimal(0);
        }else{
            cur.settlement_point_price_dollar_kwh = cur.settlement_point_price_dollar_kwh_uncapped
        }
        const to_return = {
            date_str,
            date,
            date_ms,
            date_formatted,
            ...cur
        };

        return to_return;
    }

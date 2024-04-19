all calculations are based off a timestamp from the start of time time winddow 

raw production is 0 regardless of if panels' inverter was recording or not, per the API ingestion 

Warning: first bills can be werid with how they calculate stuff. Don't rely on this for a first bill


variables
config.bill_periods
config.check_email
config.print_largest_production
config.print_bill_period_results

daily price (populated after given day)
https://www.ercot.com/content/cdr/html/real_time_spp.html

day-ahead-prices
https://www.ercot.com/content/cdr/html/dam_spp.html

historical price info
https://www.ercot.com/mktinfo/prices
use link "Historical RTM Load Zone and Hub Prices"
should be
https://www.ercot.com/mp/data-products/data-product-details?id=NP6-785-ER


make sure to download PRODUCTION AND PRICE data at end of bill period... the numbers the day after seem to change 
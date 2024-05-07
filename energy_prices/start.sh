# ls /tmp/pdfs/ | awk '{ print "libreoffice --headless --convert-to svg --outdir /tmp/svgs /tmp/pdfs/" $0 }' | bash

cd /xls_history;

ls -alt; 

echo "libreoffice does not work to convert if there is a space in the file name"

# this can be used to convert histoical data to single sheets... need to filter out zone I care about 
libreoffice --headless --convert-to "csv:Text - txt - csv (StarCalc):44,34,,,,,,,,,,-1" ./*.xlsx

# pull out desired data from each csv file  
ls | gawk -v q="'" 'match($0, /_([0-9]{4}).*-(.*)\.csv/, a){print "bash -c " q "cat \""$0"\" | head -n1 ; cat \""$0"\" | grep LZ_NORTH | grep -v LZEW" q " > "a[1]"_"a[2]".csv; rm \"" $0"\""}' | bash;  
mv *.csv /historical


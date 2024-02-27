ls /tmp/pdfs/ | awk '{ print "libreoffice --headless --convert-to svg --outdir /tmp/svgs /tmp/pdfs/" $0 }' | bash

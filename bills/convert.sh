# NOTE: THIS SHOULD ONLY USE BILLS FROM CHARIOT... OTHERS WILL CAUSE THE NODE PROGRAM TO FAIL
docker run -it -v ./svgs:/tmp/svgs -v ./pdfs:/tmp/pdfs convert-pdf-svg

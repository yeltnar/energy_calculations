FROM ubuntu:latest 

ARG DEBIAN_FRONTEND=noninteractive
ARG TZ=America/Chicago

RUN apt update; bash -c 'apt install -y libreoffice <<< "2"'

COPY ./start.sh /start.sh

RUN chmod +x /start.sh

CMD /start.sh

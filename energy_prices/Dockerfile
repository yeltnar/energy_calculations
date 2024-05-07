FROM nixos/nix:latest 

ARG TZ=America/Chicago

COPY ./shell.nix /shell.nix

RUN nix-shell /shell.nix 

COPY ./start.sh /start.sh

RUN chmod +x /start.sh

CMD nix-shell --command /start.sh /shell.nix

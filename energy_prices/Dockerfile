FROM nixos/nix:latest 

ARG TZ=America/Chicago


RUN nix-env -iA nixpkgs.neovim -iA nixpkgs.libreoffice -iA nixpkgs.gawk 

COPY ./start.sh /start.sh

RUN chmod +x /start.sh

CMD /start.sh

if [ -z "$CONTAINER_RUNTIME" ];then
        CONTAINER_RUNTIME="docker";
fi

"$CONTAINER_RUNTIME" run -it \
-v ./xls_history:/xls_history \
-v ./shell.nix:/shell.nix \
-v ./historical:/historical convert-xls-svg-ercot-history

if [ -z "$CONTAINER_RUNTIME" ];then
	CONTAINER_RUNTIME="docker";
fi

"$CONTAINER_RUNTIME" build -t convert-xls-svg-ercot-history .

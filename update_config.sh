mkdir new_config
./mount_config.sh 
cp enc_config/* new_config/
vim "new_config/local.json"

mksquashfs ./new_config ./new_config.sqfs
truncate -s +8M new_config.sqfs
cryptsetup -q reencrypt --encrypt --type luks2 --resilience none --disable-locks --reduce-device-size 8M new_config.sqfs

mv new_config.sqfs config.sqfs

echo "should rm -rf new_config"

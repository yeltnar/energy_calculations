# squash - https://tldp.org/HOWTO/SquashFS-HOWTO/creatingandusing.html
# encrypted - https://gist.github.com/ansemjo/6f1cf9d9b8f7ce8f70813f52c63b74a6

# mount
mkdir -p config
sudo cryptsetup open ./config.sqfs energy_config_sqfs # create unencrypted device
sudo mount -t squashfs /dev/mapper/energy_config_sqfs ./config # mount unencrypted device


# torche
Torrent file checker - verifies files in a directory against a torrent file in the same directory. Should work anywhere you can install node.js

Useful when you get files from a questionable source. For example, suppose your internet at home is extremely slow so you end up getting a Linux ISO on a USB drive from a shady "friend". Your would like to make sure the ISO has not been tampered with:

0. Install torche: `npm install torche -g` (make sure you have npm [set up to install globals properly.](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally))
1. Create a new folder, let's say Ubuntu20LTS
2. Copy the questionable ISO in there (ubuntu-20.04-desktop-amd64.iso)
3. Download the .torrent file into the same directory (ubuntu-20.04-desktop-amd64.iso.torrent)
4. Run `torche ./Ubuntu20LTS/`
5. Make sure you get a successful verification:
```
$ torche Ubuntu20LTS/
VERIFYING ubuntu-20.04-desktop-amd64.iso.torrent
9FC20B9E98EA98B4A35E6223041A5EF94EA27809
Found 1 of 1 in torrent
VERIFIED 2,590/2,590 PIECES; 2,715,254,784 BYTES OK
```

Obviously this is a contrived example since most modern Linux ISOs will have signature files for this exact purpose. torche is useful when all you have is a torrent file and absolutely nothing else to go on.

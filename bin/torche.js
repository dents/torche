"use strict";

const fs = require('fs')
const path = require('path');
const crypto = require('crypto');

const walk = require('walk');
const levenshtein = require('fast-levenshtein');
const parseTorrent = require('parse-torrent');

const foundFiles = {};
const closestFilesInT = {};
const coveredInT = {};

if (process.argv.length < 3) {
    console.error(`Usage: torche "directory to verify"`);
    process.exit(1);
}

const dirToScan = process.argv[2];

const filesInDir = fs.readdirSync(dirToScan, { encoding: 'utf8' });
const firstTorrent = filesInDir.find(fName => fName.endsWith('.torrent'));
if (firstTorrent === undefined) {
    console.error(`NO TORRENT FILE FOUND IN "${dirToScan}"`);
    process.exit(1);
}

console.log(`VERIFYING ${firstTorrent}`);

const t = parseTorrent(fs.readFileSync(path.join(dirToScan, firstTorrent)));
console.log(t.infoHash.toUpperCase());
// t.files[ { offset, name, length }]
// t.pieceLength, lastPieceLength, pieces
let shortestDirInT = null;
for (const tFile of t.files) {
    const curDir = path.parse(tFile.path).dir;
    if (shortestDirInT === null) {
        shortestDirInT = curDir;
    } else {
        if (curDir === null || curDir.length < shortestDirInT.length) {
            shortestDirInT = curDir;
        }
    }
}

const topScanDir = path.basename(dirToScan);
const ignoreRoot = (topScanDir === shortestDirInT ? path.normalize(path.join(dirToScan, '..')) : dirToScan);

const walker = walk.walk(dirToScan, {});
walker.on("file", function (root, fileStats, next) {
    // TODO: this &#039; thing is a bit of a hack, need to make it a confgurable setting for html entity decoding
    const fixedName = fileStats.name.split('&#039;').join('\'');
    const relativeRoot = path.relative(ignoreRoot, root);
    let osPath = path.join(relativeRoot, fixedName);

    if (topDir(osPath) !== shortestDirInT) {
        osPath = path.join(shortestDirInT, osPath);
    }

    let minLev = null;
    let closestInT = null;
    let curIX = -1;
    const alts = {};
    for (const tFile of t.files) {
        ++curIX;

        if (tFile.length !== fileStats.size) {
            continue; // size mismatch, skip
        }

        const curLev = levenshtein.get(osPath, tFile.path, { useCollator: true });
        alts[tFile.path] = curLev;
        if (closestInT === null || minLev === null || curLev < minLev) {
            minLev = curLev;
            closestInT = tFile;
        }
        if (minLev == 0) {
            break;
        }
    }

    if (closestInT === null) {
        // no files matched by size, this OS file is not in the torrent, skip it
        next();
        return;
    }

    if (minLev > 1) {
        if (!(closestInT.path in closestFilesInT)) {
            closestFilesInT[closestInT.path] = [];
        }
        closestFilesInT[closestInT.path].push({ stat: fileStats, torrent: closestInT, root: root, score: minLev });
        // console.log(`CLOSE ${osPath} -> ${closestInT.path} ${minLev}`);
    } else {
        foundFiles[closestInT.path] = { stat: fileStats, torrent: closestInT, root: root };
        // console.log(`EXACT ${closestInT.path} = ${osPath}`)

        if (!(curIX in coveredInT)) {
            coveredInT[curIX] = [];
        }

        coveredInT[curIX].push(Object.keys(foundFiles).length - 1);
    }

    next();
});
walker.on("errors", function (root, nodeStatsArray, next) {
    console.error(`ERROR: ${JSON.stringify(nodeStatsArray, null, 4)}`);
    next();
});
walker.on("end", function () {
    const totalFound = Object.keys(foundFiles).length + Object.keys(closestFilesInT).length;
    console.log(`Found ${totalFound} of ${t.files.length} in torrent`);
    for (const tFile of t.files) {
        // console.log(` ${tFile.offset}: ${tFile.name}+${tFile.length}`);
        if (!(tFile.path in foundFiles) && !(tFile.path in closestFilesInT)) {
            console.log(' x ' + tFile.path);
        }
    }

    if (totalFound < 1) {
        process.exit(1);
    }

    let failedPieces = [];

    let bytesFound = 0;

    let curFileIX = 0;
    let openedFile = null;
    for (let pieceIX = 0; pieceIX < t.pieces.length; ++pieceIX) {
        const expectedSHA1 = t.pieces[pieceIX];
        const curHash = crypto.createHash('sha1');
        let totalHashed = 0;
        let curPiecePos = 0;
        const filesInPiece = [];
        if (openedFile !== null) {
            filesInPiece.push({
                path: openedFile.path,
                begin: openedFile.pos,
                total: openedFile.foundFile.stat.size,
                end: null,
            });
        }

        while (curPiecePos < t.pieceLength) {
            if (curFileIX >= t.files.length) {
                // we are on last piece and ran out of files, stop processing
                break;
            }

            if (openedFile === null) {
                if (curFileIX < t.files.length) {
                    const curName = t.files[curFileIX].path;
                    if (curName in foundFiles) {
                        // console.log(`EXACT MATCH ${curName}`);
                        const ff = foundFiles[curName];
                        const fullPath = path.join(ff.root, ff.stat.name);
                        openedFile = {
                            path: fullPath,
                            pos: 0,
                            foundFile: ff,
                            fd: fs.openSync(fullPath, 'r'),
                        };
                        filesInPiece.push({
                            path: openedFile.path,
                            begin: openedFile.pos,
                            total: openedFile.foundFile.stat.size,
                            end: null,
                        });
                        // console.log(` opened file ${fullPath}:${ff.stat.size}; fd=${openedFile.fd}`);
                    } else if (curName in closestFilesInT) {
                        const closest = closestFilesInT[curName].sort((a, b) => b.score - a.score);
                        const ff = closest[0];
                        const fullPath = path.join(ff.root, ff.stat.name);
                        //console.log(`CLOSEST MATCH:`);
                        //console.log(` - ${curName}`);
                        //console.log(` + ${fullPath}`);
                        //console.log(closestFilesInT[curName]);
                        openedFile = {
                            path: fullPath,
                            pos: 0,
                            foundFile: ff,
                            fd: fs.openSync(fullPath, 'r'),
                        };
                        filesInPiece.push({
                            path: openedFile.path,
                            begin: openedFile.pos,
                            total: openedFile.foundFile.stat.size,
                            end: null,
                        });
                    } else {
                        console.log(`NO LOCAL FILE MATCHES "${curName}"`);
                    }
                } else {
                    openedFile = null;
                }
            }

            const remainInPiece = t.pieceLength - curPiecePos;
            const readSize = openedFile !== null ? Math.min(openedFile.foundFile.stat.size - openedFile.pos, remainInPiece) : remainInPiece;
            const readBuf = Buffer.allocUnsafe(readSize);
            try {
                if (openedFile !== null) {
                    const bytesRead = fs.readSync(openedFile.fd, readBuf, 0, readBuf.byteLength, null);
                    if (bytesRead < 1) {
                        console.error(`FAILED READING FILE ${openedFile.path}; fd=${openedFile.fd}; pos=${openedFile.pos}; br=${bytesRead} (NEEDED ${readSize})`);
                        process.exit(1);
                    }

                    if (bytesRead !== readSize) {
                        // should never happen?
                        console.error(`WARNING: WANTED ${readSize.toLocaleString()} BUT GOT ${bytesRead.toLocaleString()} BYTES FROM "${openedFile.path}"`);
                    }

                    totalHashed += bytesRead;
                    curHash.update(readBuf);
                    bytesFound += readBuf.byteLength;
                    curPiecePos += bytesRead;
                    openedFile.pos += bytesRead;

                    if (openedFile.pos == openedFile.foundFile.stat.size || bytesRead < readSize) {
                        filesInPiece[filesInPiece.length - 1].end = openedFile.pos;
                        fs.closeSync(openedFile.fd);
                        // console.log(` closed file ${openedFile.path}; fd=${openedFile.fd}`);
                        openedFile = null;
                        ++curFileIX;
                    }
                } else {
                    readBuf.fill(0);
                    totalHashed += readBuf.byteLength;
                    curHash.update(readBuf);
                    bytesFound += readBuf.byteLength;
                    curPiecePos += readBuf.byteLength;
                    ++curFileIX;
                }
            } catch (err) {
                console.log(` ERROR READING "${openedFile.path}": ${err}`);
            }
        }

        const calcHash = curHash.digest();
        if (expectedSHA1 !== calcHash.toString('hex')) {
            const niceFP = [];
            let totalBytes = 0;
            for (const fp of filesInPiece) {
                if (fp.end === null) {
                    fp.end = t.pieceLength - totalBytes;
                } else {
                    totalBytes += (fp.end - fp.begin);
                }

                niceFP.push(`${fp.begin}-${fp.end} (${(fp.end - fp.begin).toLocaleString()}) of ${fp.total.toLocaleString()}   ${fp.path}`)
            }
            failedPieces.push({ piece: pieceIX, files: niceFP });
            console.log(` PIECE ${pieceIX.toLocaleString()}/${t.pieces.length.toLocaleString()} @ ${t.pieceLength.toLocaleString()}b H=${totalHashed.toLocaleString()} FAIL`);
        } else {
            // console.log(` PIECE ${pieceIX.toLocaleString()}/${t.pieces.length.toLocaleString()} @ ${t.pieceLength.toLocaleString()}b H=${totalHashed.toLocaleString()} OK`);
        }

        curPiecePos = 0;
    }

    if (failedPieces.length > 0) {
        console.log(`FINISHED WITH ${failedPieces.length.toLocaleString()}/${t.pieces.length.toLocaleString()} MISSING`);
        console.log(JSON.stringify(failedPieces, null, 4));
    } else {
        console.log(`VERIFIED ${(t.pieces.length - failedPieces.length).toLocaleString()}/${t.pieces.length.toLocaleString()} PIECES; ${bytesFound.toLocaleString()} BYTES OK`)
    }
});

function topDir(pathToCheck) {
    let remain = pathToCheck;
    let result = null;
    do {
        result = path.dirname(remain);
        remain = path.normalize(path.join(remain, '..'));
    } while (remain !== null && remain.length > 0 && remain !== '.');
    return result;
}

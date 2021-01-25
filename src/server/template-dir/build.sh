source env.txt
nvm use
npm install
npm install $DEPS
INDEX=0
for P in $ENTRIES
do
    echo $P
    ./node_modules/.bin/esbuild --bundle --outfile=$BASE/$P.bundle.js --sourcemap=external --platform=browser --target=$BROWSER --minify $BASE/$P
    let INDEX=${INDEX}+1
done
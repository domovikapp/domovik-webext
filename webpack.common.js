const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: {
        newtab: "./src/ts/newtab.ts",
        settings: "./src/ts/settings.ts",
        popup: "./src/ts/popup.ts",
        background: "./src/ts/background.ts",
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.s[ac]ss$/i,
                use: [
                    // Creates `style` nodes from JS strings
                    "style-loader",
                    // Translates CSS into CommonJS
                    "css-loader",
                    // Compiles Sass to CSS
                    "sass-loader",
                ],
            },
            {
                test: /\.(woff|woff2|eot|ttf|otf)$/i,
                type: 'asset/resource',
            },
        ],
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'src/html',
                    to: 'html/'
                },
                {
                    from: 'icons/*',
                    to: ''
                },
                {
                    from: '_locales',
                    to: '_locales'
                },
            ]
        })
    ]
};

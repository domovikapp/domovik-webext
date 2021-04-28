const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = merge(common, {
    mode: 'production',
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new webpack.DefinePlugin({
            PRODUCTION: JSON.stringify(true),
        }),
        new CopyWebpackPlugin({
            patterns: [{
                from: 'manifest.build.json',
                to: 'manifest.json',
                transform(content) {
                    return content
                        .toString()
                        .replace('HTTP_PERMISSION', "https://domovik.app/api/*");
                },
            }]
        })
    ]
});

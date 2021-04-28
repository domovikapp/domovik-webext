const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-source-map',
    watch: true,
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist_dev'),
    },
    plugins: [
        new webpack.DefinePlugin({
            PRODUCTION: JSON.stringify(false),
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'manifest.build.json',
                    to: 'manifest.json',
                    transform(content) {
                        return content
                            .toString()
                            .replace('HTTP_PERMISSION', "*://*/*");
                    }
                },
            ]
        })
    ]
});

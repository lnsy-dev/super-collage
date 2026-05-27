import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const outputFileName = process.env.OUTPUT_FILE_NAME || 'main.min.js';
const separateCss = process.env.SEPARATE_CSS === 'true';
const port = process.env.PORT || 3008;

/**
 * Check if assets directory exists and has files
 */
const assetsPath = path.join(__dirname, 'assets');
const hasAssets = (() => {
  try {
    return fs.existsSync(assetsPath) && fs.readdirSync(assetsPath).length > 0;
  } catch {
    return false;
  }
})();

const isDev = process.env.NODE_ENV !== 'production';

export default {
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: isDev ? '[name].js' : outputFileName,
    clean: true,
  },
  mode: isDev ? 'development' : 'production',
  devServer: {
    static: {
      directory: path.join(__dirname, 'assets'),
      publicPath: '/',
    },
    port: port,
    hot: true,
    open: false,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          separateCss ? MiniCssExtractPlugin.loader : 'style-loader',
          {
            loader: 'css-loader',
            options: isDev ? {} : {
              importLoaders: 1,
              modules: false,
            }
          },
          {
            loader: 'postcss-loader',
            options: isDev ? {} : {
              postcssOptions: {
                plugins: [
                  ['cssnano', {
                    preset: ['default', {
                      discardComments: {
                        removeAll: true,
                      },
                    }],
                  }],
                ],
              },
            }
          }
        ],
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: path.resolve(__dirname, 'scripts/transform-workers.js'),
          },
          {
            loader: 'swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'ecmascript',
                },
                target: 'es2015',
              },
            },
          },
        ],
      },
    ],
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: isDev ? 'single' : false,
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
    }),
    ...(separateCss ? [new MiniCssExtractPlugin()] : []),
    ...(hasAssets
      ? [
          new CopyWebpackPlugin({
            patterns: [
              {
                from: 'assets',
                to: '.',
              },
            ],
          }),
        ]
      : []),
  ],
};

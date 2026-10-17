const defaultsDeep = require('lodash.defaultsdeep');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var webpack = require('webpack');

// Plugins
var CopyWebpackPlugin = require('copy-webpack-plugin');
var HtmlWebpackPlugin = require('html-webpack-plugin');
var TWGenerateServiceWorkerPlugin = require('./src/playground/generate-service-worker-plugin');
var HardSourceWebpackPlugin = require('hard-source-webpack-plugin');
var MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

// PostCss
var autoprefixer = require('autoprefixer');
var postcssVars = require('postcss-simple-vars');
var postcssImport = require('postcss-import');

const STATIC_PATH = process.env.STATIC_PATH || '/static';

const PAINT_ROOT = path.resolve(__dirname, '..', 'paint-src');
const PAINT_SRC = path.join(PAINT_ROOT, 'src');
const EXPLICITLY_ALIASED = ['text-encoding', 'scratch-render-fonts'];

const forceSingleCopyOfPaintDeps = () => {
    let paintPackage;
    try {
        paintPackage = require(path.join(PAINT_ROOT, 'package.json'));
    } catch (e) {
        return {};
    }
    const names = Object.keys(Object.assign({}, paintPackage.dependencies, paintPackage.peerDependencies));
    return names.reduce((aliases, name) => {
        if (EXPLICITLY_ALIASED.indexOf(name) !== -1) return aliases;
        const ours = path.resolve(__dirname, 'node_modules', name);
        if (fs.existsSync(ours)) aliases[name] = ours;
        return aliases;
    }, {});
};

let root = process.env.ROOT || '';
if (root.length > 0 && !root.endsWith('/')) {
    throw new Error('If ROOT is defined, it must have a trailing slash.');
}

const MONACO_LANGUAGES = ['javascript', 'typescript', 'json', 'css', 'scss', 'less', 'html', 'xml', 'markdown',
    'yaml', 'ini', 'lua', 'python', 'cpp', 'shell', 'sql'];
const bakedEnv = {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    'process.env.DEBUG': Boolean(process.env.DEBUG),
    'process.env.ANNOUNCEMENT': JSON.stringify(process.env.ANNOUNCEMENT || ''),
    'process.env.ENABLE_SERVICE_WORKER': JSON.stringify(process.env.ENABLE_SERVICE_WORKER || ''),
    'process.env.ROOT': JSON.stringify(root),
    'process.env.ROUTING_STYLE': JSON.stringify(process.env.ROUTING_STYLE || 'filehash'),
    'process.env.DIMOD_API_BASE': JSON.stringify(process.env.DIMOD_API_BASE || '/api'),
    'process.env.DIMOD_ASSET_KEY': JSON.stringify(process.env.DIMOD_ASSET_KEY || ''),
    'process.env.DIMOD_WARP_ASSET_BASE': JSON.stringify(process.env.DIMOD_WARP_ASSET_BASE || ''),
    'process.env.DIMOD_WS_BASE': JSON.stringify(process.env.DIMOD_WS_BASE || ''),
    'process.env.DIMOD_SITE_ORIGIN': JSON.stringify(process.env.DIMOD_SITE_ORIGIN || '')
};

const hexToHsl = hex => {
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d) + (g < b ? 6 : 0);
        else if (max === g) h = ((b - r) / d) + 2;
        else h = ((r - g) / d) + 4;
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
};
const accentIconCache = new Map();
function isAccentIcon (file) {
    if (!/\.svg$/.test(file) || /[\\/](libraries|tw-missing-project)[\\/]/.test(file) || (/[\\/]addons[\\/]/.test(file) && !/[\\/](onion-skinning|paint-snap)[\\/]/.test(file))) return false;
    if (accentIconCache.has(file)) return accentIconCache.get(file);
    let result = false;
    try {
        const text = require('fs').readFileSync(file, 'utf8');
        let purple = 0;
        let other = 0;
        for (const m of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
            const [h, s, l] = hexToHsl(m[1]);
            if (s < 20 || l > 94 || l < 6) continue;
            if (h >= 232 && h <= 268 && s >= 25) purple++;
            else other++;
        }
        result = purple > 0 && other === 0;
    } catch (e) {
        result = false;
    }
    accentIconCache.set(file, result);
    return result;
}

const MINIFY = Boolean(process.env.DIMOD_MINIFY);
const OWN_SOURCE_ROOTS = [path.resolve(__dirname, 'src') + path.sep, PAINT_SRC + path.sep];
const chunkHasOwnSource = chunk => {
    for (const m of chunk.modulesIterable) {
        const file = m.resource || (m.rootModule && m.rootModule.resource) || '';
        if (OWN_SOURCE_ROOTS.some(root => file.startsWith(root))) return true;
    }
    return false;
};

const bakedEnvHash = crypto.createHash('sha256')
    .update(JSON.stringify(bakedEnv) + (MINIFY ? 'min' : '') + (process.env.DIMOD_DEV_REACT ? '' : 'prodreact'))
    .digest('hex')
    .slice(0, 12);

const htmlWebpackPluginCommon = {
    root: root,
    meta: JSON.parse(process.env.EXTRA_META || '{}')
};

const base = {
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devtool: process.env.SOURCEMAP ? process.env.SOURCEMAP : (process.env.NODE_ENV === 'production' || MINIFY) ? false : 'cheap-module-source-map',
    devServer: {
        contentBase: path.resolve(__dirname, 'build'),
        host: '0.0.0.0',
        compress: true,
        port: process.env.PORT || 8601,
        historyApiFallback: {
            rewrites: [
                { from: /^\/\d+\/?$/, to: '/index.html' },
                { from: /^\/\d+\/fullscreen\/?$/, to: '/fullscreen.html' },
                { from: /^\/\d+\/editor\/?$/, to: '/editor.html' },
                { from: /^\/\d+\/playground\/?$/, to: '/playground.html' },
                { from: /^\/\d+\/embed\/?$/, to: '/embed.html' },
                { from: /^\/addons\/?$/, to: '/addons.html' }
            ]
        }
    },
    output: {
        library: 'GUI',
        filename: process.env.NODE_ENV === 'production' ? 'js/[name].[contenthash].js' : 'js/[name].js?v=[hash]',
        chunkFilename: process.env.NODE_ENV === 'production' ? 'js/[name].[contenthash].js' : 'js/[name].js?v=[chunkhash]',
        publicPath: root
    },
    resolve: {
        symlinks: false,
        alias: Object.assign(process.env.DIMOD_DEV_REACT ? {} : {
            'react$': path.resolve(__dirname, 'node_modules/react/cjs/react.production.min.js'),
            'react-dom$': path.resolve(__dirname, 'node_modules/react-dom/cjs/react-dom.production.min.js'),
            'scheduler$': path.resolve(__dirname, 'node_modules/scheduler/cjs/scheduler.production.min.js')
        }, forceSingleCopyOfPaintDeps(), {
            'scratch-paint$': path.join(PAINT_SRC, 'index.js'),
            'text-encoding$': path.resolve(__dirname, 'src/lib/tw-text-encoder'),
            'scratch-render-fonts$': path.resolve(__dirname, 'src/lib/tw-scratch-render-fonts')
        })
    },
    node: { fs: 'empty' },
    module: {
        rules: [
            {
                test: /\.jsx?$/,
                include: [
                    path.resolve(__dirname, 'src'),
                    PAINT_SRC,
                    /node_modules[\\/]scratch-[^\\/]+[\\/]src/,
                    /node_modules[\\/]pify/,
                    /node_modules[\\/]@vernier[\\/]godirect/
                ],
                use: [
                    {
                        loader: 'cache-loader',
                        options: {
                            cacheDirectory: path.resolve(__dirname, MINIFY ? '.webpack/cache1-babel-min' : '.webpack/cache1-babel')
                        }
                    },
                    {
                        loader: 'babel-loader',
                        options: {
                            babelrc: false,
                            comments: !MINIFY,
                            minified: MINIFY,
                            compact: MINIFY ? true : 'auto',
                            plugins: [
                                ['react-intl', {
                                    messagesDir: './translations/messages/'
                                }]
                            ],
                            presets: ['@babel/preset-env', '@babel/preset-react']
                        }
                    }
                ]
            },
            {
                test: /\.css$/,
                include: /node_modules[\\/]monaco-editor[\\/]/,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.css$/,
                exclude: /node_modules[\\/]monaco-editor[\\/]/,
                use: [
                    { loader: 'style-loader' },
                    { 
                        loader: 'cache-loader',
                        options: {
                            cacheDirectory: path.resolve(__dirname, '.webpack/cache2-postcss')
                        }
                    },
                    { 
                        loader: 'css-loader', 
                        options: {
                            modules: true,
                            importLoaders: 1,
                            localIdentName: '[name]_[local]_[hash:base64:5]',
                            camelCase: true
                        }
                    },
                    { 
                        loader: 'postcss-loader',
                        options: {
                            ident: 'postcss',
                            plugins: () => [postcssImport, postcssVars, autoprefixer]
                        }
                    }
                ]
            }
        ]
    },
    plugins: [
        new HardSourceWebpackPlugin({
            cacheDirectory: path.resolve(__dirname, '.webpack', `cache4-hard-source-${bakedEnvHash}-m${MONACO_LANGUAGES.length}`)
        }),
        new MonacoWebpackPlugin({languages: MONACO_LANGUAGES})
    ],
};

if (!process.env.CI) base.plugins.push(new webpack.ProgressPlugin());

module.exports = [
    defaultsDeep({}, base, {
        entry: {
            'editor': './src/playground/editor.jsx',
            'playground': './src/playground/playground.jsx',
            'player': './src/playground/player.jsx',
            'fullscreen': './src/playground/fullscreen.jsx',
            'embed': './src/playground/embed.jsx',
            'addon-settings': './src/playground/addon-settings.jsx',
            'credits': './src/playground/credits/credits.jsx'
        },
        output: { path: path.resolve(__dirname, 'build'), pathinfo: !MINIFY },
        module: {
            rules: base.module.rules.concat([
                {
                    test: /\.svg$/,
                    include: [isAccentIcon],
                    use: [
                        { loader: 'file-loader', options: { outputPath: 'static/assets/', name: '[hash].accent.[ext]' } },
                        path.resolve(__dirname, 'scripts/accent-svg-loader.js')
                    ]
                },
                {
                    test: /\.(svg|png|wav|gif|jpg|mp3|ttf|otf|ico)$/,
                    exclude: [isAccentIcon],
                    loader: 'file-loader',
                    options: { outputPath: 'static/assets/' }
                }
            ])
        },
        optimization: Object.assign({
            splitChunks: {
                chunks: 'all',
                minChunks: 2,
                minSize: 50000,
                maxInitialRequests: 5
            }
        }, MINIFY ? {
            minimize: true,
            minimizer: [new (require('terser-webpack-plugin'))({
                chunkFilter: chunkHasOwnSource,
                cache: path.resolve(__dirname, '.webpack/cache5-terser'),
                parallel: 2,
                sourceMap: false,
                extractComments: false,
                terserOptions: {
                    compress: false,
                    mangle: true,
                    keep_fnames: true,
                    keep_classnames: true,
                    output: {comments: false}
                }
            })]
        } : {}),
        plugins: base.plugins.concat([
            new webpack.DefinePlugin(bakedEnv),
            new HtmlWebpackPlugin({
                chunks: ['editor'], template: 'src/playground/index.ejs', filename: 'editor.html',
                title: 'Dimod - Studio', ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['playground'], template: 'src/playground/index.ejs', filename: 'playground.html',
                title: 'Dimod - Studio Playground', ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['player'], template: 'src/playground/index.ejs', filename: 'index.html',
                title: 'Dimod - Studio', ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['fullscreen'], template: 'src/playground/index.ejs', filename: 'fullscreen.html',
                title: 'Dimod - Studio', ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['embed'], template: 'src/playground/index.ejs', filename: 'embed.html',
                title: 'Embedded Project - Dimod', noTheme: true, ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['addon-settings'], template: 'src/playground/simple.ejs', filename: 'addons.html',
                title: 'Addon Settings - Dimod Studio', ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['credits'], template: 'src/playground/simple.ejs', filename: 'credits.html',
                title: 'Dimod Studio Credits', noSplash: true, ...htmlWebpackPluginCommon
            }),
            new CopyWebpackPlugin({ patterns: [{ from: 'static', to: '' }] }),
            new CopyWebpackPlugin({ patterns: [{ from: 'node_modules/scratch-blocks/media', to: 'static/blocks-media' }] }),
            new CopyWebpackPlugin({ patterns: [{ from: 'extensions/**', to: 'static', context: 'src/examples' }] }),
            new TWGenerateServiceWorkerPlugin()
        ])
    })
];

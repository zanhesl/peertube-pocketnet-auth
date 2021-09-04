const pocketnet = require('./libs/pocketnet.js');
const { Api, ProxyRequest, Proxy16, Node } = require('./libs/api');
const querystring = require('querystring');
const { hexEncode } = require('./libs/hex');
const signatureChecker = require('./libs/authMethods');
const generateError = require('./libs/errorGenerator');
const ReputationStorageController = require('./libs/reputationCache');
const getUserQuota = require('./libs/quotaCalculator');

const MINUTES_STORED = 2;

const MINIMUM_QUOTA = 2000000000;

const DEFAULT_AUTH_ERROR_TEXT = 'Invalid Credentials';
const NOT_ENOUGH_COINS_TEXT = 'You need at least 5 PKOIN to publish videos'

const POCKETNET_PROXY_META = [
  {
    host: 'pocketnet.app',
    port: 8899,
    wss: 8099,
    direct: '',
  },
  {
    host: '1.pocketnet.app',
    port: 8899,
    wss: 8099,
    direct: '',
  },
];

const reputationController = new ReputationStorageController(MINUTES_STORED);

const setHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS, PUT, PATCH, DELETE',
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept',
  );

  res.setHeader('Access-Control-Allow-Credentials', true);

  return res;
};

async function register({
  registerIdAndPassAuth,
  registerExternalAuth,
  getRouter,
  peertubeHelpers,
  registerHook,
}) {
  // Init pocketnet proxies
  const api = new Api({});

  api.init();

  POCKETNET_PROXY_META.map((proxy) => api.addproxy(proxy));

  const redirectUrl =
    peertubeHelpers.config.getWebserverUrl() +
    '/plugins/pocketnet-auth/router/code-cb';

  // Register auth method
  const result = registerExternalAuth({
    authName: 'pocketnet-auth',

    authDisplayName: () => 'Pocketnet BlockChain Auth',

    getWeight: () => 60,

    onAuthRequest: (req, res) => {
      return res.redirect(redirectUrl);
    },
  });

  const router = getRouter();

  // Callback
  router.use('/code-cb', (req, res) => {
    //Cors headers
    setHeaders(res);

    const { address, nonce, pubkey, signature, v } = req.body;

    if (!address)
      return res
        .status(400)
        .send(generateError('Ivalid Credentials: no address field'));

    const outputRes = {
      res,

      redirect(string) {
        const { username, externalAuthToken } = querystring.parse(
          string.replace('/login?', ''),
        );

        this.res.json({ username, externalAuthToken });
      },
    };

    const authDataValid = signatureChecker.v1({
      address,
      nonce,
      pubkey,
      signature,
      v,
    });

    if (!authDataValid.result)
      return res
        .status(400)
        .send(generateError(authDataValid.error || NOT_ENOUGH_COINS_TEXT));

    if (reputationController.check(address))
      return result.userAuthenticated({
        req,
        res: outputRes,
        username: address,
        email: `${address}@example.com`,
        role: 2,
        displayName: address,
      });

    // Check user reputation
    return api
      .rpc('getuserstate', [address])
      .then((data = {}) => {
        console.log('Node data', data);

        const userQuota = getUserQuota(data);

        if (userQuota) {
          reputationController.set(address, data.trial);

          result.userAuthenticated({
            req,
            res: outputRes,
            username: address,
            email: `${address}@example.com`,
            role: 2,
            displayName: address,
            userQuota,
          });
        } else {
          return res
            .status(400)
            .send(
              generateError(authDataValid.error || DEFAULT_AUTH_ERROR_TEXT),
            );
        }
      })
      .catch(() => {
        //temporary solution befory dynamic reputation
        const userQuota = getUserQuota({});

        if (userQuota) {
          return result.userAuthenticated({
            req,
            res: outputRes,
            username: address,
            email: `${address}@example.com`,
            role: 2,
            displayName: address,
            userQuota,
          });
        } else {
          return result.userAuthenticated({
            req,
            res: outputRes,
            username: address,
            email: `${address}@example.com`,
            role: 2,
            displayName: address,
            userQuota: MINIMUM_QUOTA,
          });
        }

        // return res
        //   .status(400)
        //   .json({ error: 'Unable to get reputation from proxy' });
      });
  });
}

async function unregister() {
  return;
}

module.exports = {
  register,
  unregister,
};

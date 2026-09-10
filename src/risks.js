'use strict';
// Risk zones: what an agent must not touch alone. Detected from dependencies (any ecosystem)
// and from path names. Each hit becomes a "human-only" line in the safe-list and AGENTS.md.

const RISK_SIGNALS = [
  { id: 'payments', label: 'Payments / billing',
    deps: ['stripe', '@stripe/stripe-react-native', 'stripe-go', 'braintree', 'paypal', 'yookassa', 'cloudpayments', 'adyen', 'razorpay', 'square', 'lemonsqueezy', 'paddle', 'dj-stripe'],
    paths: [/payment/i, /billing/i, /(^|\/)checkout/i, /subscription/i, /invoice/i] },
  { id: 'auth', label: 'Authentication / sessions',
    deps: ['passport', 'next-auth', '@auth/core', 'lucia', 'firebase', 'firebase-admin', '@react-native-firebase/auth', 'jsonwebtoken', 'jose', 'expo-auth-session', 'expo-apple-authentication', '@react-native-google-signin/google-signin',
      'django-allauth', 'authlib', 'pyjwt', 'python-jose', 'passlib', 'flask-login', 'fastapi-users', 'golang-jwt', 'jwt-go', 'oauth2', 'jsonwebtoken', 'oauth2-proxy'],
    paths: [/(^|\/)auth/i, /(^|\/)sessions?([-_.]?(store|manager|service|middleware))?\.[a-z]+$/i, /\/sessions?\//i, /login/i, /oauth/i, /(^|\/)tokens?[^/]*\.[a-z]+$/i, /permission/i] },
  { id: 'push', label: 'Push notifications',
    deps: ['expo-notifications', '@react-native-firebase/messaging', 'onesignal', 'react-native-onesignal', 'web-push', 'pyfcm', 'apns2', 'firebase-admin'],
    paths: [/push/i, /notification/i] },
  { id: 'deeplinks', label: 'Deep linking / attribution',
    deps: ['react-native-branch', 'expo-linking', '@react-native-firebase/dynamic-links', 'appsflyer', 'react-native-appsflyer', 'adjust'],
    paths: [/deeplink/i, /deep-link/i, /linking/i, /(^|\/)branch/i] },
  { id: 'native', label: 'Native code / build config', deps: [],
    paths: [/^android\//, /^ios\//, /app\.config\.(js|ts)$/, /^app\.json$/, /^eas\.json$/, /^plugins\//] },
  { id: 'migrations', label: 'Database migrations / schema',
    deps: ['prisma', 'knex', 'drizzle-orm', 'drizzle-kit', 'typeorm', 'sequelize', 'mongoose', 'kysely', 'alembic', 'django', 'sqlalchemy', 'goose', 'golang-migrate', 'pressly/goose', 'sqlx', 'diesel', 'sea-orm', 'gorm.io', 'atlas'],
    paths: [/migration/i, /schema\.prisma$/, /drizzle\//i, /seeds?\//i, /^db\//i, /^prisma\//i] },
  { id: 'secrets', label: 'Secrets and environment', deps: [],
    paths: [/^\.env(?!\.example|\.sample)/, /secrets?\//i, /(^|\/)keys\//i, /credentials?\.(json|ya?ml)$/i, /\.pem$/, /\.key$/, /\.p8$/, /\.p12$/, /\.keystore$/, /\.jks$/] },
  { id: 'infra', label: 'Infrastructure / CI / deploy', deps: [],
    paths: [/^\.github\/workflows\//, /^\.gitlab-ci/, /^Jenkinsfile/, /Dockerfile/, /docker-compose/, /^compose\.ya?ml$/, /^infra\//, /^terraform\//, /\.tf$/, /^k8s\//, /^helm\//, /^deploy\//, /^\.circleci\//, /^ansible\//] },
  { id: 'realtime', label: 'Realtime / sockets / offline sync',
    deps: ['socket.io', 'socket.io-client', 'ws', '@react-native-community/netinfo', 'channels', 'websockets', 'gorilla/websocket', 'nhooyr.io/websocket', 'tokio-tungstenite', 'centrifuge', 'pusher'],
    paths: [/socket/i, /offline/i, /(^|\/)sync/i, /websocket/i, /realtime/i] },
  { id: 'jobs', label: 'Background jobs / queues',
    deps: ['bullmq', 'bull', 'agenda', 'bee-queue', 'celery', 'rq', 'dramatiq', 'huey', 'arq', 'asynq', 'machinery', 'sidekiq', 'lapin', 'kafkajs', 'amqplib', 'kafka-go', 'sarama'],
    paths: [/(^|\/)jobs?\//i, /(^|\/)workers?\//i, /(^|\/)queues?\//i, /(^|\/)tasks?\//i, /cron/i] },
  { id: 'email', label: 'Outbound email / SMS',
    deps: ['nodemailer', '@sendgrid/mail', 'resend', 'postmark', 'mailgun', 'twilio', 'django-anymail', 'sendgrid', 'boto3'],
    paths: [/mailer/i, /(^|\/)emails?\//i, /(^|\/)sms[-_.a-z]*\.(ts|tsx|js|py|go|rs)$/i, /templates\/mail/i] },
  { id: 'i18n', label: 'Localization',
    deps: ['i18next', 'react-i18next', 'expo-localization', 'next-intl', 'vue-i18n', 'babel', 'fluent'],
    paths: [/i18n/i, /locales?\//i, /translations?\//i] },
];

function depMatches(depNames, token) {
  const t = token.toLowerCase();
  return depNames.some((d) => d === t || d.endsWith('/' + t) || d.includes('/' + t + '/') || d.startsWith(t + '/'));
}

function detectRisks(stack, files) {
  const risks = [];
  for (const sig of RISK_SIGNALS) {
    const matchedDeps = sig.deps.filter((d) => depMatches(stack.depNames, d));
    const isTest = (f) => /(^|\/)(__tests__|tests?|spec|e2e|fixtures?)\//i.test(f) || /[._-](test|spec)\.[a-z]+$/i.test(f);
    const matchedPaths = files.filter((f) => sig.paths.some((re) => re.test(f))).sort((a, b) => isTest(a) - isTest(b)).slice(0, 12);
    if (sig.id === 'native' && !(stack.frameworks.reactNative || stack.frameworks.expo)) continue;
    if (matchedDeps.length || matchedPaths.length) risks.push({ id: sig.id, label: sig.label, deps: [...new Set(matchedDeps)], paths: matchedPaths, humanOnly: true });
  }
  return risks;
}

module.exports = { RISK_SIGNALS, detectRisks };

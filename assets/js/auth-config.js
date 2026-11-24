const campusCareCallbackUrl = new URL("./index.html", window.location.href).href;

window.CAMPUSCARE_AUTH_CONFIG = Object.freeze({
  region: "ap-south-1",
  userPoolId: "ap-south-1_8iNwV0JIz",
  appClientId: "67th727t345t0a5ct2r2juqu6n",
  hostedUiDomain: "https://your-domain.auth.ap-south-1.amazoncognito.com",
  redirectUri: campusCareCallbackUrl,
  logoutUri: campusCareCallbackUrl,
  apiBaseUrl: "https://your-url.lambda-url.ap-south-1.on.aws",
  adminGroup: "CampusCareAdmins",
  scopes: ["openid", "email", "profile"]
});

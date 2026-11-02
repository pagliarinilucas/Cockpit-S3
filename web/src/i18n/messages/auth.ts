// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
export const en = {
  auth: {
    subtitle: 'STORAGE CONSOLE',
    or: 'or',
    usePassword: 'Sign in with username and password',
    username: 'Username',
    password: 'Password',
    connecting: 'Connecting…',
    connect: 'Connect',
    missingCredentials: 'Enter your username and password.',
    apiUnavailable: 'API unreachable (port 3000).',
    passwordDisabled: 'Password sign-in is disabled for your account. Use SSO.',
    invalidCredentials: 'Invalid username or password.',
    ssoFailed: 'Could not sign in with SSO.',
    ssoErrors: {
      disabled: 'SSO sign-in is not enabled on this instance.',
      discovery: 'Could not reach the identity provider. Please try again in a moment.',
      idp: 'The identity provider refused or cancelled the sign-in.',
      state: 'The sign-in attempt expired or could not be validated. Please try again.',
      token: 'Could not validate the identity provider response.',
      no_username: 'The identity provider did not return a username.',
      domain: 'Your email does not belong to an authorized domain.',
      not_provisioned: 'Your account does not exist in Cockpit S3 yet. Ask an administrator for access.',
      inactive: 'Your account is disabled. Contact an administrator.',
    },
  },
};

export const pt: typeof en = {
  auth: {
    subtitle: 'STORAGE CONSOLE',
    or: 'ou',
    usePassword: 'Entrar com usuário e senha',
    username: 'Usuário',
    password: 'Senha',
    connecting: 'Conectando…',
    connect: 'Conectar',
    missingCredentials: 'Informe usuário e senha.',
    apiUnavailable: 'API indisponível (porta 3000).',
    passwordDisabled: 'O login com senha está desativado para sua conta. Use o SSO.',
    invalidCredentials: 'Usuário ou senha inválidos.',
    ssoFailed: 'Não foi possível entrar com SSO.',
    ssoErrors: {
      disabled: 'O login via SSO não está habilitado nesta instância.',
      discovery: 'Não foi possível contatar o provedor de identidade. Tente novamente em instantes.',
      idp: 'O provedor de identidade recusou ou cancelou o login.',
      state: 'A tentativa de login expirou ou não pôde ser validada. Tente novamente.',
      token: 'Não foi possível validar a resposta do provedor de identidade.',
      no_username: 'O provedor de identidade não informou um nome de usuário.',
      domain: 'Seu e-mail não pertence a um domínio autorizado.',
      not_provisioned: 'Sua conta ainda não existe no Cockpit S3. Peça acesso a um administrador.',
      inactive: 'Sua conta está desativada. Fale com um administrador.',
    },
  },
};

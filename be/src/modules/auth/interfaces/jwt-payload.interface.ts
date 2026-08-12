export interface JwtPayload {
  sub: string;
  email: string;
}

export interface RequestUser {
  id: string;
  email: string;
}

import { Button, ButtonSpinner, ButtonText } from '@gluestack-ui/themed';

type Props = {
  disabled: boolean;
  loading: boolean;
  onSignIn: (idToken?: string) => Promise<void>;
  onError: (message: string) => void;
};

// `onError` is part of Props (shared with the .web.tsx variant, which needs
// it for failures that happen before onSignIn is ever called — loading the
// Google script, missing client ID) but isn't read here: on native,
// onSignIn IS the whole flow (GoogleSignin.signIn()), and its caller
// (login.tsx's handleGoogle) already awaits and catches it internally, so
// there's no failure path on this platform that onError would ever see.
export function GoogleSignInButton({
  disabled,
  loading,
  onSignIn,
}: Props) {
  return (
    <Button
      size='lg'
      variant='outline'
      onPress={() => onSignIn()}
      isDisabled={disabled}
      testID='login-google-button'
    >
      {loading && <ButtonSpinner mr='$2' />}
      <ButtonText>Continuar con Google</ButtonText>
    </Button>
  );
}

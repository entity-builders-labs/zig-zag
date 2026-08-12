import { Button, ButtonSpinner, ButtonText } from '@gluestack-ui/themed';

type Props = {
  disabled: boolean;
  loading: boolean;
  onSignIn: (idToken?: string) => Promise<void>;
  onError: (message: string) => void;
};

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

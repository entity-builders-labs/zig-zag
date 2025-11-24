import {
  Button,
  ButtonText,
  Center,
  Heading,
  VStack,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const router = useRouter();

  return (
    <Center flex={1}>
      <VStack space='md' alignItems='center'>
        <Heading size='xl'>Profile</Heading>
        <Button onPress={() => router.push('/')} size='lg'>
          <ButtonText>Volver a Home</ButtonText>
        </Button>
      </VStack>
    </Center>
  );
}

import {
  Button,
  ButtonText,
  Center,
  Heading,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/auth';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  return (
    <Center flex={1}>
      <VStack space='md' alignItems='center'>
        <Heading size='xl'>Profile</Heading>
        {user && (
          <VStack space='xs' alignItems='center'>
            {user.name && <Text fontWeight='$bold'>{user.name}</Text>}
            <Text color='$textLight500'>{user.email}</Text>
          </VStack>
        )}
        <Button onPress={() => router.push('/')} size='lg'>
          <ButtonText>Volver a Home</ButtonText>
        </Button>
        <Button onPress={signOut} size='lg' variant='outline' testID='logout-button'>
          <ButtonText>Cerrar sesión</ButtonText>
        </Button>
      </VStack>
    </Center>
  );
}

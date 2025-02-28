import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ButtonText, Center, Heading, VStack } from '@gluestack-ui/themed';
import { RootStackParamList } from '../navigation/AppNavigator';

type ProfileScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Profile'>;

type Props = {
navigation: ProfileScreenNavigationProp;
};

export default function ProfileScreen({ navigation }: Props) {
return (
    <Center flex={1}>
    <VStack space="md" alignItems="center">
        <Heading size="xl">Profile</Heading>
        <Button
        onPress={() => navigation.navigate('Home')}
        size="lg"
        >
        <ButtonText>Volver a Home</ButtonText>
        </Button>
    </VStack>
    </Center>
);
}


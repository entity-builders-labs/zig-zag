import { Center, Heading, Text } from '@gluestack-ui/themed';
import { FONT_DISPLAY } from '@/constants/typography';

export default function MapScreen() {
  return (
    <Center flex={1} bg='$backgroundLight50'>
      <Heading style={{ fontFamily: FONT_DISPLAY }}>Mapa</Heading>
      <Text color='$textLight500'>Próximamente...</Text>
    </Center>
  );
}

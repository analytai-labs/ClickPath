import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

interface WelcomeEmailProps {
  userFirstname: string;
}

export const WelcomeEmail = ({ userFirstname }: WelcomeEmailProps) => (
  <Html>
    <Head />
    <Preview>ClickPath - Enterprise URL Shortener & Link Management</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={paragraph}>Hi {userFirstname ? userFirstname : "there"},</Text>
        <Text style={paragraph}>Welcome and thank you for signing up to ClickPath!</Text>
        <Text style={paragraph}>
          It&apos;s great to have you onboard. If you have any questions or feature requests you
          want to share with us, feel free to reach out to our team at{" "}
          <Link href="mailto:support@clickpath.analytai.in" style={link}>
            support@clickpath.analytai.in
          </Link>
        </Text>
        <Section style={btnContainer}>
          <Button style={button} href="https://clickpath.analytai.in/dashboard">
            Visit your Dashboard
          </Button>
        </Section>
        <Text style={paragraph}>
          Best,
          <br />
          The ClickPath Team
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          Thank you for joining ClickPath! If you have any questions, feedback, or feature requests,
          feel free to reply directly to this email or visit{" "}
          <Link href="https://clickpath.analytai.in" style={link}>
            clickpath.analytai.in
          </Link>
          .
        </Text>
      </Container>
    </Body>
  </Html>
);

export const renderWelcomeEmail = (name: string) => {
  return render(<WelcomeEmail userFirstname={name} />);
};

WelcomeEmail.PreviewProps = {
  userFirstname: "ClickPath User",
} as WelcomeEmailProps;

export default WelcomeEmail;

const main = {
  backgroundColor: "#ffffff",
  color: "#000000",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};

const container = {
  margin: "0 auto",
  maxWidth: "560px",
  padding: "32px 20px 48px",
};

const paragraph = {
  color: "#000000",
  fontSize: "16px",
  lineHeight: "26px",
};

const link = {
  color: "#000000",
  textDecoration: "underline",
};

const btnContainer = {
  textAlign: "center" as const,
};

const button = {
  backgroundColor: "#2563eb",
  borderRadius: "4px",
  color: "#fff",
  fontSize: "16px",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 18px",
};

const hr = {
  borderColor: "#e5e5e5",
  margin: "20px 0",
};

const footer = {
  color: "#000000",
  fontSize: "12px",
  lineHeight: "20px",
};

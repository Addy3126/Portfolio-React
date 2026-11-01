// Site copy.
export const site = {
  name: 'Aditya Sharma',
  tagline: 'Software & Web Developer',
  location: 'Delhi, India',
  timeZone: 'Asia/Kolkata',
  status: 'Available for work',
}

export const about = {
  heading: 'About',
  body:
    'A 21-year-old studying Data Science and Artificial Intelligence (Computer Science Engineering) at SRM University, Sonipat. Most of my spare time goes into web projects, and I like picking up anything that looks interesting and useful.',
  skills: ['HTML & CSS', 'JavaScript', 'React', 'Three.js', 'Node.js', 'Python', 'MongoDB', 'MySQL'],
}

// One project per lit tower (four towers). `link` is optional; private repos have none.
export const projects = [
  {
    name: 'Sourish Industries',
    summary:
      'Business website for an automotive drivetrain parts manufacturer: product catalogue with detail views, slideshow, and a contact form that emails enquiries through a hardened Express API.',
    stack: ['React', 'TypeScript', 'Vite', 'Express', 'Nodemailer'],
    link: 'https://sourish-industries.vercel.app',
    linkLabel: 'Visit site',
  },
  {
    name: 'PrajnaAI',
    summary:
      'AI document analysis platform. DocuDigest lets you chat with uploaded PDFs; DocuLens checks banking documents against regulatory standards. Includes an admin console.',
    stack: ['React', 'TypeScript', 'Material UI', 'Redux', 'LangChain', 'Docker'],
    note: 'Private repository',
  },
  {
    name: 'Unified Cancer Classification',
    summary:
      'Deep-learning classifier for medical images across several cancer types, with Grad-CAM heatmaps that show what the model looked at, served through a Flask API and a React upload interface.',
    stack: ['TensorFlow', 'Keras', 'OpenCV', 'Flask', 'React', 'TypeScript'],
    link: 'https://unified-cancer-classification.vercel.app',
    linkLabel: 'Try it',
  },
  {
    name: 'Finance Tracker',
    summary: 'Personal finance app to log income and expenses by category, with charts, JWT authentication and a MongoDB backend.',
    stack: ['MongoDB', 'Express', 'React', 'Node.js', 'Redux Toolkit', 'Chart.js'],
    link: 'https://github.com/Addy3126/Finance-Tracker-using-MERN',
    linkLabel: 'View code',
  },
]

export const contact = {
  heading: 'Say hello',
  email: 'adi.sharma3126@gmail.com',
  phone: '+91 81788 59524',
  phoneHref: 'tel:+918178859524',
  links: [
    { label: 'GitHub', href: 'https://github.com/Addy3126' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/aditya-sharma-8a5476282/' },
  ],
}
